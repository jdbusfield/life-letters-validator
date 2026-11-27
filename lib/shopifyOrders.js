import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { hashToken, fault } from "./surveyData.js";

export function automationConfig(env = process.env) {
  return {
    enabled: env.SHOPIFY_AUTOMATION_ENABLED === "true",
    shop: (env.SHOPIFY_SHOP_DOMAIN || "").trim().toLowerCase(),
    webhookSecret: env.SHOPIFY_WEBHOOK_SECRET || "",
    linkSecret: env.SURVEY_LINK_SECRET || "",
    productIds: (env.SHOPIFY_SURVEY_PRODUCT_IDS || "").split(",").map(x => x.trim()).filter(Boolean),
    baseUrl: env.PUBLIC_BASE_URL || "",
    emailKey: env.RESEND_API_KEY || "",
    emailFrom: env.SURVEY_EMAIL_FROM || "",
    replyTo: env.SURVEY_EMAIL_REPLY_TO || "",
    acceptTestOrders: env.SHOPIFY_ACCEPT_TEST_ORDERS === "true",
  };
}

export function configurationProblems(config) {
  const missing = [];
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(config.shop)) missing.push("Shopify store domain");
  if (!config.webhookSecret) missing.push("Shopify webhook signing secret");
  if (config.linkSecret.length < 32) missing.push("Private link signing secret");
  if (!config.productIds.length || config.productIds.some(id => !/^\d+$/.test(id))) missing.push("Eligible product IDs");
  try { if (new URL(config.baseUrl).protocol !== "https:") throw Error(); } catch { missing.push("HTTPS personalization form address"); }
  if (!config.emailKey) missing.push("Resend email key");
  if (!config.emailFrom || /[\r\n]/.test(config.emailFrom)) missing.push("Verified sending address");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.replyTo)) missing.push("Reply-to address");
  return missing;
}

export function verifyShopifyHmac(body, header, secret) {
  if (!Buffer.isBuffer(body) || typeof header !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(header) || !secret) return false;
  const actual = Buffer.from(header, "base64");
  const expected = createHmac("sha256", secret).update(body).digest();
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function shopifyId(value, label) {
  if (typeof value === "number" && !Number.isSafeInteger(value)) throw fault(400, `${label} cannot be read safely`);
  const id = String(value ?? "");
  if (!/^\d{1,20}$/.test(id)) throw fault(400, `${label} is invalid`);
  return id;
}

// Deterministic tokens let the durable email queue reconstruct the same link
// after a restart. Only their hashes are stored in the database.
export function tokenForPurchasedSet(config, orderId, lineId, unit) {
  if (config.linkSecret.length < 32) throw fault(503, "Private link signing is not configured");
  return createHmac("sha256", config.linkSecret)
    .update(["life-letters-purchased-set-v1", config.shop, orderId, lineId, unit].join("\0"))
    .digest("base64url");
}

export function paidOrderPlan(payload, config, now = Date.now()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw fault(400, "Order data is invalid");
  if (payload.financial_status !== "paid") return { ignored: "not_paid" };
  if (payload.cancelled_at) return { ignored: "cancelled" };
  if (payload.test && !config.acceptTestOrders) return { ignored: "test_order" };
  if (!Array.isArray(payload.line_items)) throw fault(400, "Order items are missing");
  const orderId = shopifyId(payload.id, "Order ID");
  const eligible = payload.line_items.filter(item => config.productIds.includes(String(item.product_id)));
  if (!eligible.length) return { ignored: "no_eligible_items" };
  const name = [payload.customer?.first_name, payload.customer?.last_name].filter(Boolean).join(" ").slice(0, 120);
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const reference = String(payload.name || `#${payload.order_number || orderId}`).slice(0, 100);
  const base = { shop: config.shop, orderId, orderReference: reference, customerName: name,
    customerEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null,
    testOrder: !!payload.test, surveys: [], sets: [] };
  const seenLines = new Set();
  let index = 0;
  for (const item of eligible) {
    const lineId = shopifyId(item.id, "Line item ID");
    if (seenLines.has(lineId)) throw fault(400, "Repeated line item ID");
    seenLines.add(lineId);
    const count = item.current_quantity ?? item.quantity;
    if (!Number.isInteger(count) || count < 0 || count > 20 || index + count > 20) return { ...base, issue: "set_quantity_needs_review" };
    for (let unit = 1; unit <= count; unit++) {
      index++;
      const id = randomUUID();
      const row = { id, customer_email: base.customerEmail, customer_name: name, order_reference: reference,
        set_label: `Set ${index}`, unit_index: unit, shopify_shop_domain: config.shop,
        shopify_order_id: orderId, shopify_line_item_id: lineId,
        provisioning_key: `shopify:${config.shop}:${orderId}:${lineId}:${unit}`,
        access_token_hash: hashToken(tokenForPurchasedSet(config, orderId, lineId, unit)),
        expires_at: new Date(now + 180 * 86400_000).toISOString(), draft: { customerName: name, letters: {} } };
      base.surveys.push(row);
      base.sets.push({ id, label: row.set_label, lineId, unit });
    }
  }
  if (!index) return { ignored: "no_remaining_sets" };
  if (!base.customerEmail) return { ...base, surveys: [], sets: [], issue: "customer_email_missing" };
  return base;
}

export function purchasedSetLinks(job, surveys, config) {
  const origin = new URL(config.baseUrl).origin;
  return job.message.sets.map(set => {
    const survey = surveys.find(row => row.id === set.id);
    const token = tokenForPurchasedSet(config, job.shopify_order_id, set.lineId, set.unit);
    if (!survey || survey.access_token_hash !== hashToken(token) || survey.revoked_at || new Date(survey.expires_at).getTime() <= Date.now()) {
      throw Object.assign(new Error("A personalization form link changed or expired before email sending"), { permanent: true, code: "survey_link_changed" });
    }
    return { label: set.label, link: `${origin}/#survey=${set.id}&token=${token}` };
  });
}
