import { Router } from "express";
import supabase from "./supabase.js";
import { isId } from "./surveyData.js";

export const retentionEnabled = (env = process.env) => env.SURVEY_RETENTION_ENABLED === "true";

export function validatedManifest(job) {
  if (!isId(job.survey_id) || !Array.isArray(job.manifest)) throw Error("invalid_retention_manifest");
  const prefix = `surveys/${job.survey_id}/`;
  if (job.manifest.some(file => !file || !["survey-photos", "survey-pdfs"].includes(file.bucket) || typeof file.path !== "string" || !file.path.startsWith(prefix) || file.path.includes("..") || file.path.endsWith("/"))) throw Error("invalid_retention_manifest");
  return job.manifest;
}

export function createRetentionProcessor({ db = supabase, enabled = retentionEnabled } = {}) {
  let running = false, stopping = false;
  const process = async () => {
    if (running || stopping || !db || !enabled()) return;
    running = true;
    let checkError = null;
    try {
      for (let count = 0; count < 3 && !stopping; count++) {
        const { data, error } = await db.rpc("claim_life_letters_retention");
        if (error) throw Error("retention_claim_failed");
        const job = data?.[0];
        if (!job) break;
        let code = null;
        try {
          const manifest = validatedManifest(job);
          for (const bucket of ["survey-photos", "survey-pdfs"]) {
            const paths = [...new Set(manifest.filter(file => file.bucket === bucket).map(file => file.path))];
            for (let offset = 0; offset < paths.length; offset += 100) {
              const result = await db.storage.from(bucket).remove(paths.slice(offset, offset + 100));
              if (result.error) throw Error("retention_storage_failed");
            }
          }
        } catch (error) {
          code = ["invalid_retention_manifest", "retention_storage_failed"].includes(error.message) ? error.message : "retention_processing_failed";
        }
        const result = await db.rpc("finish_life_letters_retention", { p_survey_id: job.survey_id, p_claim_token: job.claim_token, p_error: code });
        if (result.error || result.data !== true) checkError = code || "retention_retry_required";
      }
    } catch { checkError = "retention_check_failed"; }
    finally {
      try {
        const { error } = await db.rpc("record_life_letters_retention_check", { p_error: checkError });
        if (error) console.error("Photo retention check could not be recorded");
      } catch { console.error("Photo retention check could not be recorded"); }
      running = false;
    }
  };
  process.stop = () => { stopping = true; };
  return process;
}

export function startPhotoRetentionWorker() {
  const process = createRetentionProcessor();
  const tick = () => process().catch(() => console.error("Photo retention check failed"));
  tick();
  const interval = setInterval(tick, 5 * 60_000);
  interval.unref();
  return () => { clearInterval(interval); process.stop(); };
}

export function createRetentionAdminRouter({ db = supabase, enabled = retentionEnabled } = {}) {
  const router = Router();
  const route = fn => async (req,res) => { try { await fn(req,res); } catch { res.status(503).json({error:"Retention storage is not ready"}); } };
  router.use("/api/admin/photo-retention", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!req.session?.isAdmin) return res.status(401).json({ error: "Unauthorized" });
    if (req.method !== "GET" && req.headers.origin && req.headers.origin !== new URL(process.env.PUBLIC_BASE_URL || `http://${req.headers.host}`).origin) return res.status(403).json({ error: "Request not allowed" });
    if (!db) return res.status(503).json({ error: "Retention storage is not ready" });
    next();
  });
  router.get("/api/admin/photo-retention", route(async (_req,res) => {
    const { data, error } = await db.rpc("life_letters_retention_overview");
    if (error) return res.status(503).json({ error: "Retention storage is not ready" });
    res.json({ ...data, enabled: enabled() });
  }));
  router.post("/api/admin/photo-retention/:id/:action", route(async (req,res) => {
    if (!isId(req.params.id)) return res.status(400).json({ error: "Invalid set" });
    const body = req.body || {};
    let rpc, args;
    if (req.params.action === "hold" && typeof body.hold === "boolean") {
      rpc = "set_life_letters_retention_hold";
      args = { p_survey_id: req.params.id, p_hold: body.hold, p_reason: body.reason || "Open order issue" };
    } else if (req.params.action === "external-cleanup" && body.canva === true && body.workingCopies === true && body.trash === true) {
      rpc = "confirm_life_letters_external_cleanup";
      args = { p_survey_id: req.params.id };
    } else return res.status(400).json({ error: "Confirm all required cleanup steps" });
    const { data,error } = await db.rpc(rpc,args);
    if (error || data !== true) return res.status(409).json({ error: "This set changed or cleanup is not ready. Refresh and review its status." });
    res.json({ success: true });
  }));
  return router;
}
