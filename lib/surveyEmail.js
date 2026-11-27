import supabase from "./supabase.js";
import { automationConfig, configurationProblems, purchasedSetLinks } from "./shopifyOrders.js";

const escape = value => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));

export function surveyEmailMessage(job, links, config) {
  const reference = job.order_reference;
  const greeting = job.message.customerName ? `Hi ${job.message.customerName},` : "Hello,";
  const introduction = `Thank you for ordering Life Letters! Your order ${reference} is ready to personalize.`;
  const instructions = "Each set has its own private personalization form. Add your words and photos, or use our defaults. Your progress saves automatically, so reopen the same link on any device to continue. When you are ready, preview your cards and click Submit My Life Letters Cards.";
  const privacy = "Keep these links private. They expire in 180 days. Reply to this email if you need help or a replacement link.";
  return {
    from: config.emailFrom, to: [job.customer_email], reply_to: config.replyTo,
    subject: `Personalize your Life Letters cards — ${reference}`,
    text: [greeting, introduction, ...links.map(set => `${set.label}:\n${set.link}`), instructions, privacy, "With love,\nLife Letters"].join("\n\n"),
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#344f5e;max-width:600px;margin:auto"><h1 style="color:#344f5e">Let’s build your Life Letters!</h1><p>${escape(greeting)}</p><p>${escape(introduction)}</p>${links.map(set => `<p><a href="${escape(set.link)}" style="display:inline-block;padding:14px 22px;background:#4e6b7b;color:white;border-radius:24px;text-decoration:none">Personalize ${escape(set.label)}</a></p>`).join("")}<p>${escape(instructions)}</p><p style="font-size:13px">${escape(privacy)}</p><p>With love,<br>Life Letters</p></div>`,
  };
}

export async function sendSurveyEmail(job, links, config, fetchEmail = fetch) {
  let response;
  try {
    response = await fetchEmail("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${config.emailKey}`, "Content-Type": "application/json",
        "Idempotency-Key": `life-letters-survey/${job.id}` },
      body: JSON.stringify(surveyEmailMessage(job, links, config)), signal: AbortSignal.timeout(20000),
    });
  } catch { throw Object.assign(new Error("Email service did not confirm acceptance"), { code: "email_request_unconfirmed" }); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.id !== "string") {
    throw Object.assign(new Error("Email service could not accept this message"), {
      code: `email_http_${response.status}`, permanent: response.status >= 400 && response.status < 500 && response.status !== 429,
    });
  }
  return result.id;
}

export function createEmailProcessor({ db = supabase, getConfig = automationConfig, send = sendSurveyEmail } = {}) {
  let running = false;
  return async function processEmails() {
    const config = getConfig();
    if (running || !db || !config.enabled || configurationProblems(config).length) return;
    running = true;
    try {
      const { data: jobs, error } = await db.rpc("claim_life_letters_survey_emails");
      if (error) throw error;
      for (const job of jobs || []) {
        let outcome;
        try {
          const { data: surveys, error: lookupError } = await db.from("surveys")
            .select("id,access_token_hash,expires_at,revoked_at").in("id", job.message.sets.map(set => set.id));
          if (lookupError) throw lookupError;
          const links = purchasedSetLinks(job, surveys || [], config);
          const providerId = await send(job, links, config);
          outcome = { p_provider_id: providerId, p_error_code: null, p_permanent: false };
        } catch (error) {
          outcome = { p_provider_id: null, p_error_code: /^[a-z0-9_]+$/.test(error.code || "") ? error.code : "email_processing_failed", p_permanent: error.permanent === true };
        }
        const { error: saveError } = await db.rpc("finish_life_letters_survey_email", {
          p_job_id: job.id, p_claim_token: job.claim_token, ...outcome,
        });
        if (saveError) console.error("Personalization form email result could not be saved", { jobId: job.id });
      }
    } finally { running = false; }
  };
}

export function startSurveyEmailWorker() {
  const processEmails = createEmailProcessor();
  const tick = () => processEmails().catch(() => console.error("Personalization form email queue could not be checked"));
  tick();
  const interval = setInterval(tick, 15000);
  interval.unref();
  return () => clearInterval(interval);
}
