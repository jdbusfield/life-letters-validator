import { createHash, randomBytes, randomUUID } from "node:crypto";
import { DEFAULT_CARDS, PHONICS_VERSION } from "./letterData.js";

export const LETTERS = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];
export const PHOTO_BUCKET = "survey-photos";
export const PDF_BUCKET = "survey-pdfs";
export const cookiePath = id => `/api/surveys/${id}`;
export const hashToken = token => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export const isId = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const validToken = value => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
export function fault(status, message) { return Object.assign(new Error(message), { status }); }
export function text(value, max, label) {
  if (typeof value !== "string" || value.length > max) throw fault(400, `${label} is invalid`);
  return value.trim();
}
export function photoUrl(surveyId, photoId) { return `${cookiePath(surveyId)}/photos/${photoId}`; }
export function safeDraft(input, survey, photos = []) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !input.letters || typeof input.letters !== "object" || Array.isArray(input.letters)) throw fault(400, "Survey data is invalid");
  const owned = new Map(photos.map(photo => [photo.storage_path, photo]));
  const letters = {};
  for (const [letter, value] of Object.entries(input.letters)) {
    if (!LETTERS.includes(letter) || !value || typeof value !== "object") throw fault(400, "Letter data is invalid");
    if (typeof value.isDefault !== "boolean") throw fault(400, "Default selection is invalid");
    const word = value.isDefault ? DEFAULT_CARDS[letter] : text(value.word || "", 100, "Word");
    let path = value.isDefault ? null : value.storagePath || null;
    if (path && (!owned.has(path) || owned.get(path).letter !== letter)) throw fault(400, "This photo does not belong to this survey and letter");
    const photo = owned.get(path);
    letters[letter] = { word, isDefault: value.isDefault, storagePath: path,
      photoUrl: photo ? photoUrl(survey.id, photo.id) : null,
      status: ["empty", "pending", "valid", "invalid", "error"].includes(value.status) ? value.status : "pending",
      feedback: text(value.feedback || "", 400, "Feedback") };
  }
  return { customerName: text(input.customerName || "", 120, "Name"),
    customerEmail: survey.customer_email, orderNumber: survey.order_reference,
    setLabel: text(input.setLabel || "", 120, "Set name"),
    phonicsVersion: PHONICS_VERSION, savedAt: new Date().toISOString(), letters };
}
export function submissionEntries(draft, photos) {
  const owned = new Map(photos.map(p => [p.storage_path, p]));
  return LETTERS.map(letter => {
    const entry = draft.letters?.[letter];
    if (!entry || !entry.word || (!entry.isDefault && !owned.has(entry.storagePath))) throw fault(422, "Complete all 26 letters with a word and photo, or choose Use Default");
    return { letter, word: entry.isDefault ? DEFAULT_CARDS[letter] : entry.word,
      is_default: entry.isDefault, photo_storage_path: entry.isDefault ? null : entry.storagePath,
      photo_url: entry.isDefault ? null : entry.photoUrl, validation_status: entry.isDefault ? "skipped" : "valid" };
  });
}
export function makeSurveyRows(input, baseUrl) {
  const email = text(input.customerEmail || "", 254, "Email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fault(400, "Enter a valid customer email");
  const name = text(input.customerName || "", 120, "Name");
  const reference = text(input.orderReference || "", 100, "Order reference");
  const count = input.setCount;
  if (!reference || !Number.isInteger(count) || count < 1 || count > 20 || !isId(input.requestId)) throw fault(400, "An order reference, request ID, and 1–20 sets are required");
  const origin = new URL(baseUrl);
  if (origin.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(origin.hostname)) throw fault(503, "Survey address is not configured");
  return Array.from({ length: count }, (_, index) => {
    const id = randomUUID(), token = newToken();
    const row = { id, customer_email: email, customer_name: name, order_reference: reference,
      set_label: `Set ${index + 1}`, unit_index: index + 1,
      provisioning_key: `${input.requestId}:${index + 1}`, access_token_hash: hashToken(token),
      expires_at: new Date(Date.now() + 180 * 86400_000).toISOString(), draft: { customerName: name, letters: {} } };
    return { row, link: `${origin.origin}/#survey=${id}&token=${token}` };
  });
}
