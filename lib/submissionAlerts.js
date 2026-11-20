import { Router } from "express";
import supabase from "./supabase.js";

const escape = value => String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const email = value => typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export function submissionAlertConfig(env = process.env) {
  return { enabled: env.SURVEY_SUBMISSION_ALERTS_ENABLED === "true", recipient: env.SURVEY_SUBMISSION_EMAIL_TO || "",
    emailKey: env.RESEND_API_KEY || "", emailFrom: env.SURVEY_EMAIL_FROM || "", baseUrl: env.PUBLIC_BASE_URL || "" };
}

export function submissionAlertProblems(config) {
  const missing = [];
  if (!email(config.recipient)) missing.push("Notification email address");
  if (!config.emailKey) missing.push("Resend email key");
  if (!config.emailFrom || /[\r\n]/.test(config.emailFrom)) missing.push("Verified sending address");
  try { if (new URL(config.baseUrl).protocol !== "https:") throw Error(); } catch { missing.push("HTTPS survey address"); }
  return missing;
}

export function submissionAlertMessage(job, config) {
  const adminUrl = `${new URL(config.baseUrl).origin}/admin`;
  const reference = String(job.order_reference || "Manual survey").replace(/[\r\n]/g, " ").slice(0, 100);
  const label = String(job.set_label || "Life Letters set").replace(/[\r\n]/g, " ").slice(0, 120);
  const detail = `${reference} — ${label}`;
  const instructions = "A parent has submitted their Life Letters cards. Open the admin dashboard to review the current words, photos, and PDF before printing. If the PDF is still generating, wait or retry its export in the dashboard.";
  const check = "Before starting production, confirm payment, any cancellation or refund in Shopify, and the latest survey status. A reopened survey must be submitted again before printing.";
  return { from: config.emailFrom, to: [job.recipient_email],
    subject: `Cards submitted for review — ${detail}`,
    text: ["Life Letters cards submitted", detail, `Submitted: ${job.created_at}`, instructions, `Admin dashboard: ${adminUrl}`, check].join("\n\n"),
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#344f5e;max-width:600px;margin:auto"><h1>Cards submitted for review</h1><p><strong>${escape(detail)}</strong></p><p>Submitted: ${escape(job.created_at)}</p><p>${escape(instructions)}</p><p><a href="${escape(adminUrl)}" style="display:inline-block;padding:14px 22px;background:#4e6b7b;color:white;border-radius:24px;text-decoration:none">Review in Life Letters Admin</a></p><p>${escape(check)}</p></div>` };
}

export async function sendSubmissionAlert(job, config, fetchEmail = fetch) {
  if (!email(job.recipient_email)) throw Object.assign(new Error("Notification recipient is invalid"), { permanent: true, code: "notification_recipient_invalid" });
  let response;
  try {
    response = await fetchEmail("https://api.resend.com/emails", { method: "POST",
      headers: { Authorization: `Bearer ${config.emailKey}`, "Content-Type": "application/json", "Idempotency-Key": `life-letters-submission/${job.id}` },
      body: JSON.stringify(submissionAlertMessage(job, config)), signal: AbortSignal.timeout(20000) });
  } catch { throw Object.assign(new Error("Notification acceptance was not confirmed"), { code: "notification_request_unconfirmed" }); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.id !== "string") throw Object.assign(new Error("Notification was not accepted"), {
    code: `notification_http_${response.status}`, permanent: response.status >= 400 && response.status < 500 && response.status !== 429 });
  return result.id;
}

export function createSubmissionAlertProcessor({ db = supabase, getConfig = submissionAlertConfig, send = sendSubmissionAlert } = {}) {
  let running = false;
  return async function processSubmissionAlerts() {
    const config = getConfig();
    if (running || !db || !config.enabled || submissionAlertProblems(config).length) return;
    running = true;
    try {
      const { data: jobs, error } = await db.rpc("claim_life_letters_submission_alerts", { p_recipient: config.recipient });
      if (error) throw error;
      for (const job of jobs || []) {
        let outcome;
        try {
          const providerId = await send(job, config);
          outcome = { p_provider_id: providerId, p_error_code: null, p_permanent: false };
        } catch (error) {
          outcome = { p_provider_id: null, p_error_code: /^[a-z0-9_]+$/.test(error.code || "") ? error.code : "notification_processing_failed", p_permanent: error.permanent === true };
        }
        const { error: saveError } = await db.rpc("finish_life_letters_submission_alert", { p_job_id: job.id, p_claim_token: job.claim_token, ...outcome });
        if (saveError) console.error("Submission notification result could not be saved", { jobId: job.id });
      }
    } finally { running = false; }
  };
}

export function startSubmissionAlertWorker() {
  const process = createSubmissionAlertProcessor();
  const tick = () => process().catch(() => console.error("Submission notification queue could not be checked"));
  tick();
  const interval = setInterval(tick, 15000);
  interval.unref();
  return () => clearInterval(interval);
}

export function createSubmissionAlertAdminRouter({ db = supabase, getConfig = submissionAlertConfig } = {}) {
  const router = Router();
  router.get("/api/admin/submission-alerts", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!req.session?.isAdmin) return res.status(401).json({ error: "Unauthorized" });
    const config = getConfig();
    try {
      if (!db) throw Error();
      const { data, error } = await db.from("survey_submission_alerts")
        .select("id,order_reference,set_label,recipient_email,status,attempts,error_code,created_at,sent_at")
        .order("created_at", { ascending: false }).limit(25);
      if (error) throw error;
      res.json({ enabled: config.enabled, missing: submissionAlertProblems(config), recipient: config.recipient, jobs: data });
    } catch { res.status(503).json({ error: "Submission notification storage is not ready" }); }
  });
  return router;
}
