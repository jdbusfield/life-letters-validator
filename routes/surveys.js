import { Router } from "express";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import supabase from "../lib/supabase.js";
import { checkUploadedPhoto } from "../lib/imageCheck.js";
import { validateBatch } from "../lib/validation.js";
import { getValidationClient } from "../lib/openaiClient.js";
import { generateOrderPDF } from "../lib/pdfGenerator.js";
import { cardPersonalization } from "../lib/cardPersonalization.js";
import { PHOTO_BUCKET, LETTERS, cookiePath, hashToken, newToken, validToken, isId, fault, safeDraft, submissionEntries, makeSurveyRows, photoUrl } from "../lib/surveyData.js";

const cookieName = "ll_survey_access";
function tokenFromCookie(req) {
  return (req.headers.cookie || "").split(";").map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || "";
}
export function createSurveyRouter({ db = supabase, validate = entries => validateBatch(entries, getValidationClient), generatePDF = generateOrderPDF } = {}) {
  const router = Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
  const route = fn => async (req, res) => {
    try { await fn(req, res); } catch (error) {
      const status = error.status || (error instanceof multer.MulterError ? 413 : 500);
      if (status >= 500) console.error("Survey request failed", { code: error.code, status });
      res.status(status).json({ error: status >= 500 ? "Could not save your survey. Please try again." : error.message });
    }
  };
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(req.method) && req.headers.origin) {
      const expected = process.env.PUBLIC_BASE_URL || `http://${req.headers.host}`;
      if (req.headers.origin !== new URL(expected).origin) return res.status(403).json({ error: "Request not allowed" });
    }
    next();
  });
  async function getSurvey(id) {
    if (!db) throw fault(503, "Saved surveys are not configured yet");
    if (!isId(id)) throw fault(404, "Survey not found");
    const { data, error } = await db.from("surveys").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) throw fault(404, "Survey not found");
    return data;
  }
  function checkAccess(survey, token) {
    if (!validToken(token) || hashToken(token) !== survey.access_token_hash || survey.revoked_at || new Date(survey.expires_at).getTime() <= Date.now()) throw fault(401, "Open the private survey link from your email to continue");
  }
  async function authorize(req, allowAdmin = false) {
    const survey = await getSurvey(req.params.id);
    const token = tokenFromCookie(req);
    if (!(allowAdmin && req.session?.isAdmin)) checkAccess(survey, token);
    return { survey, token };
  }
  function editable(survey) { if (survey.status !== "draft") throw fault(409, "These cards have already been submitted. Contact Life Letters for changes."); }
  async function photosFor(id) {
    const { data, error } = await db.from("survey_photos").select("id,letter,storage_path,content_type").eq("survey_id", id);
    if (error) throw error;
    return data || [];
  }
  function publicSurvey(survey, photos) {
    const draft = safeDraft({ ...survey.draft, letters: survey.draft.letters || {} }, survey, photos);
    draft.savedAt = survey.draft.savedAt || survey.updated_at || survey.created_at;
    return { id: survey.id, status: survey.status, revision: survey.revision,
      orderReference: survey.order_reference, setLabel: survey.set_label, customerEmail: survey.customer_email,
      draft, updatedAt: survey.updated_at };
  }
  router.get("/api/survey-config", (_req, res) => res.json({ accessRequired: process.env.REQUIRE_SURVEY_ACCESS === "true" }));
  router.post("/api/surveys/:id/session", route(async (req, res) => {
    const survey = await getSurvey(req.params.id);
    checkAccess(survey, req.body.token);
    res.cookie(cookieName, req.body.token, { path: cookiePath(survey.id), httpOnly: true,
      secure: process.env.NODE_ENV === "production", sameSite: "lax",
      maxAge: Math.min(30 * 86400_000, new Date(survey.expires_at).getTime() - Date.now()) });
    res.json({ success: true });
  }));
  router.get("/api/surveys/:id", route(async (req, res) => {
    const { survey } = await authorize(req);
    res.json(publicSurvey(survey, await photosFor(survey.id)));
  }));
  router.put("/api/surveys/:id", route(async (req, res) => {
    const { survey, token } = await authorize(req);
    editable(survey);
    if (!Number.isInteger(req.body.revision) || req.body.revision < 0) throw fault(400, "A saved survey version is required");
    const draft = safeDraft(req.body.draft, survey, await photosFor(survey.id));
    const { data, error } = await db.from("surveys").update({ draft, set_label: draft.setLabel || survey.set_label,
      customer_name: draft.customerName, revision: req.body.revision + 1, updated_at: new Date().toISOString() })
      .eq("id", survey.id).eq("revision", req.body.revision).eq("status", "draft").eq("access_token_hash", hashToken(token))
      .select("revision,updated_at").maybeSingle();
    if (error) throw error;
    if (!data) throw fault(409, "This survey changed on another device. Reload before editing further.");
    res.json({ revision: data.revision, updatedAt: data.updated_at });
  }));
  router.post("/api/surveys/:id/photos/:letter", (req, res, next) => {
    // Authenticate before buffering a customer's photo.
    authorize(req).then(context => { editable(context.survey); req.surveyContext = context; next(); }).catch(error => res.status(error.status || 500).json({ error: error.status ? error.message : "Could not upload photo" }));
  }, upload.single("photo"), route(async (req, res) => {
    const { survey } = req.surveyContext;
    const letter = req.params.letter.toUpperCase();
    if (!LETTERS.includes(letter) || !req.file) throw fault(400, "A letter and photo are required");
    const check = checkUploadedPhoto(req.file.buffer);
    if (!check.ok) throw fault(422, check.reason);
    if (!["png", "jpeg"].includes(check.info.format)) throw fault(422, "Please choose a JPG or PNG photo for printing");
    try {
      const document = await PDFDocument.create();
      if (check.info.format === "png") await document.embedPng(req.file.buffer);
      else await document.embedJpg(req.file.buffer);
    } catch { throw fault(422, "This photo could not be read. Please choose another JPG or PNG."); }
    const id = randomUUID(), type = check.info.format === "png" ? "image/png" : "image/jpeg";
    const path = `surveys/${survey.id}/${letter}/${id}.${check.info.format === "png" ? "png" : "jpg"}`;
    const { error: storageError } = await db.storage.from(PHOTO_BUCKET).upload(path, req.file.buffer, { contentType: type, upsert: false });
    if (storageError) throw storageError;
    const { error } = await db.from("survey_photos").insert({ id, survey_id: survey.id, letter, storage_path: path, content_type: type });
    if (error) { await db.storage.from(PHOTO_BUCKET).remove([path]); throw error; }
    res.json({ success: true, letter, url: photoUrl(survey.id, id), storagePath: path, size: req.file.size });
  }));
  router.get("/api/surveys/:id/photos/:photoId", route(async (req, res) => {
    const { survey } = await authorize(req, true);
    if (!isId(req.params.photoId)) throw fault(404, "Photo not found");
    const { data: photo, error } = await db.from("survey_photos").select("storage_path,content_type")
      .eq("survey_id", survey.id).eq("id", req.params.photoId).maybeSingle();
    if (error) throw error;
    if (!photo || !photo.storage_path.startsWith(`surveys/${survey.id}/`)) throw fault(404, "Photo not found");
    const { data, error: storageError } = await db.storage.from(PHOTO_BUCKET).download(photo.storage_path);
    if (storageError) throw fault(404, "Photo not found");
    res.set("Content-Type", photo.content_type).set("X-Content-Type-Options", "nosniff");
    res.send(Buffer.from(await data.arrayBuffer()));
  }));
  router.post("/api/surveys/:id/submit", route(async (req, res) => {
    const { survey, token } = await authorize(req);
    if (survey.status === "submitted") return res.json({ success: true, alreadySubmitted: true, orderId: survey.submitted_order_id });
    if (req.body.revision !== survey.revision) throw fault(409, "Reload the latest saved survey before submitting");
    const photos = await photosFor(survey.id);
    const draft = safeDraft(survey.draft, survey, photos);
    if (!draft.customerName) throw fault(422, "Please enter your name");
    cardPersonalization(draft, true);
    const entries = submissionEntries(draft, photos);
    const results = await validate(entries.filter(e => !e.is_default).map(e => ({ letter: e.letter, word: e.word })));
    const invalid = entries.filter(e => !e.is_default && results[e.letter]?.valid !== true).map(e => e.letter);
    if (invalid.length) return res.status(422).json({ error: `Please check the sounds for: ${invalid.join(", ")}`, results });
    const { data, error } = await db.rpc("submit_life_letters_survey", { p_survey_id: survey.id,
      p_revision: survey.revision, p_token_hash: hashToken(token), p_entries: entries });
    if (error?.code === "40001") throw fault(409, "This survey changed. Reload before submitting.");
    if (error?.code === "42501") throw fault(401, "Open your latest private survey link to continue");
    if (error?.code === "22023") throw fault(409, "These cards are already being prepared. Contact Life Letters for help.");
    if (error) throw error;
    if (!data.alreadySubmitted) {
      const { data: order, error: orderError } = await db.from("orders").select("*").eq("id", data.orderId).single();
      if (!orderError && order) generatePDF(order, entries).catch(() => console.error("Survey PDF generation failed", { surveyId: survey.id }));
    }
    res.json({ success: true, ...data });
  }));
  router.use("/api/admin/surveys", (req, res, next) => {
    if (!req.session?.isAdmin) return res.status(401).json({ error: "Unauthorized" });
    if (!db) return res.status(503).json({ error: "Saved surveys are not configured yet" });
    next();
  });
  router.get("/api/admin/surveys", route(async (_req, res) => {
    const { data, error } = await db.from("surveys").select("id,customer_email,customer_name,order_reference,set_label,unit_index,status,revision,created_at,updated_at,submitted_order_id")
      .order("created_at", { ascending: false }).limit(100);
    if (error) throw error;
    res.json({ surveys: data });
  }));
  router.post("/api/admin/surveys", route(async (req, res) => {
    if (!process.env.PUBLIC_BASE_URL && process.env.NODE_ENV === "production") throw fault(503, "Survey address is not configured");
    const items = makeSurveyRows(req.body, process.env.PUBLIC_BASE_URL || "http://localhost:3456");
    const { error } = await db.from("surveys").insert(items.map(item => item.row));
    if (error?.code === "23505") throw fault(409, "These surveys were already created. Reissue a link from the list below.");
    if (error) throw error;
    res.status(201).json({ surveys: items.map(({ row, link }) => ({ id: row.id, setLabel: row.set_label, email: row.customer_email, link })) });
  }));
  router.post("/api/admin/surveys/:id/link", route(async (req, res) => {
    const base = process.env.PUBLIC_BASE_URL;
    if (!base) throw fault(503, "Survey address is not configured");
    const survey = await getSurvey(req.params.id);
    const token = newToken();
    const { data, error } = await db.from("surveys").update({ access_token_hash: hashToken(token), revoked_at: null,
      expires_at: new Date(Date.now() + 180 * 86400_000).toISOString(), revision: survey.revision + 1 })
      .eq("id", survey.id).eq("revision", survey.revision).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw fault(409, "The survey changed. Please try again.");
    res.json({ link: `${new URL(base).origin}/#survey=${survey.id}&token=${token}`, email: survey.customer_email, setLabel: survey.set_label });
  }));
  router.post("/api/admin/surveys/:id/reopen", route(async (req, res) => {
    const { data, error } = await db.rpc("reopen_life_letters_survey", { p_survey_id: req.params.id });
    if (error?.code === "22023") throw fault(409, "This set is already being prepared or shipped. Contact the fulfillment team before making changes.");
    if (error) throw error;
    res.json({ success: true, ...data });
  }));
  return router;
}
export default createSurveyRouter();
