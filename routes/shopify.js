import { Router, raw } from "express";
import supabase from "../lib/supabase.js";
import { automationConfig, configurationProblems, paidOrderPlan, verifyShopifyHmac } from "../lib/shopifyOrders.js";

export function createShopifyWebhookRouter({ db = supabase, getConfig = automationConfig } = {}) {
  const router = Router();
  router.post("/webhooks/shopify/orders-paid", raw({ type: "application/json", limit: "2mb" }), async (req, res) => {
    res.set("Cache-Control", "no-store");
    const config = getConfig();
    if (!config.enabled || !db || !config.webhookSecret || config.linkSecret.length < 32 || !config.productIds.length || !config.baseUrl) {
      return res.status(503).json({ error: "Order personalization is not enabled" });
    }
    if (!verifyShopifyHmac(req.body, req.get("X-Shopify-Hmac-Sha256"), config.webhookSecret)
      || req.get("X-Shopify-Shop-Domain")?.toLowerCase() !== config.shop) return res.status(401).json({ error: "Invalid webhook" });
    if (req.get("X-Shopify-Topic") !== "orders/paid") return res.status(400).json({ error: "Unsupported webhook topic" });
    const eventId = req.get("X-Shopify-Webhook-Id");
    if (!eventId || !/^[a-zA-Z0-9-]{1,100}$/.test(eventId)) return res.status(400).json({ error: "Webhook ID is missing" });
    try {
      let payload;
      try { payload = JSON.parse(req.body.toString("utf8")); } catch { return res.status(400).json({ error: "Invalid JSON" }); }
      const plan = paidOrderPlan(payload, config);
      if (plan.ignored) return res.json({ accepted: true, ignored: plan.ignored });
      const { data, error } = await db.rpc("provision_life_letters_paid_order", {
        p_shop: plan.shop, p_order_id: plan.orderId, p_event_id: eventId, p_order_reference: plan.orderReference,
        p_email: plan.customerEmail, p_name: plan.customerName, p_test_order: plan.testOrder,
        p_surveys: plan.issue ? [] : plan.surveys, p_sets: plan.issue ? [] : plan.sets, p_issue: plan.issue || null,
      });
      if (error) throw error;
      // Acknowledge only after surveys and the email job are durably committed.
      res.json({ accepted: true, duplicate: data.duplicate });
    } catch (error) {
      if (error.status === 400) return res.status(400).json({ error: error.message });
      console.error("Paid order could not be saved", { code: error.code || "unknown" });
      res.status(503).json({ error: "Could not save order personalization. Please retry." });
    }
  });
  return router;
}

export function createAutomationAdminRouter({ db = supabase, getConfig = automationConfig } = {}) {
  const router = Router();
  router.get("/api/admin/automation", async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!req.session?.isAdmin) return res.status(401).json({ error: "Unauthorized" });
    const config = getConfig();
    try {
      if (!db) return res.status(503).json({ error: "Database not configured" });
      const { data, error } = await db.from("shopify_survey_emails")
        .select("id,order_reference,customer_email,status,attempts,error_code,created_at,sent_at,test_order")
        .order("created_at", { ascending: false }).limit(25);
      if (error) throw error;
      res.json({ enabled: config.enabled, missing: configurationProblems(config), shop: config.shop, productIds: config.productIds, jobs: data });
    } catch {
      res.status(503).json({ error: "Order automation storage is not ready" });
    }
  });
  return router;
}

export default createShopifyWebhookRouter();
