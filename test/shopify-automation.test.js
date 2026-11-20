import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import express from "express";
import { automationConfig, configurationProblems, paidOrderPlan, tokenForPurchasedSet, verifyShopifyHmac, purchasedSetLinks } from "../lib/shopifyOrders.js";
import { createShopifyWebhookRouter, createAutomationAdminRouter } from "../routes/shopify.js";
import { createEmailProcessor, sendSurveyEmail, surveyEmailMessage } from "../lib/surveyEmail.js";

const config = { enabled: true, shop: "life-letters-test.myshopify.com", webhookSecret: "test-only-webhook-secret",
  linkSecret: "test-only-private-link-secret-32-characters", productIds: ["123"], baseUrl: "https://survey.example.com",
  emailKey: "test-only-email-key", emailFrom: "Life Letters <cards@mail.example.com>", replyTo: "help@example.com", acceptTestOrders: false };
const order = () => ({ id: 10001, name: "#1001", financial_status: "paid", email: "Parent@example.com",
  customer: { first_name: "Test", last_name: "Parent" }, line_items: [{ id: 20001, product_id: 123, quantity: 2 }] });

test("paid order creates one link per eligible unit and excludes unrelated products", () => {
  const input = order();
  input.line_items.push({ id: 20002, product_id: 999, quantity: 3 });
  const plan = paidOrderPlan(input, config);
  assert.equal(plan.surveys.length, 2);
  assert.deepEqual(plan.sets.map(set => set.label), ["Set 1", "Set 2"]);
  assert.equal(plan.customerEmail, "parent@example.com");
  assert.notEqual(plan.surveys[0].access_token_hash, plan.surveys[1].access_token_hash);
  assert.equal(JSON.stringify(plan).includes(tokenForPurchasedSet(config, "10001", "20001", 1)), false);
  const replay = paidOrderPlan(input, config);
  assert.deepEqual(replay.surveys.map(row => row.provisioning_key), plan.surveys.map(row => row.provisioning_key));
  assert.deepEqual(replay.surveys.map(row => row.access_token_hash), plan.surveys.map(row => row.access_token_hash));
});

test("unpaid, cancelled, test, and unrelated orders do not create surveys", () => {
  for (const [change, expected] of [[{ financial_status: "pending" }, "not_paid"], [{ cancelled_at: "2026-11-15" }, "cancelled"], [{ test: true }, "test_order"], [{ line_items: [] }, "no_eligible_items"]]) {
    assert.equal(paidOrderPlan({ ...order(), ...change }, config).ignored, expected);
  }
  assert.equal(paidOrderPlan({ ...order(), test: true }, { ...config, acceptTestOrders: true }).surveys.length, 2);
});

test("missing email and excessive quantities become visible review cases", () => {
  const missing = paidOrderPlan({ ...order(), email: null }, config);
  assert.equal(missing.issue, "customer_email_missing");
  assert.equal(missing.surveys.length, 0);
  const large = order(); large.line_items[0].quantity = 21;
  assert.equal(paidOrderPlan(large, config).issue, "set_quantity_needs_review");
  const remaining = order(); remaining.line_items[0].current_quantity = 1;
  assert.equal(paidOrderPlan(remaining, config).surveys.length, 1);
});

test("private links are stable after restart, distinct across purchases, and fail closed after replacement", () => {
  const plan = paidOrderPlan(order(), config);
  const job = { shopify_order_id: plan.orderId, message: { sets: plan.sets } };
  const links = purchasedSetLinks(job, plan.surveys, config);
  assert.equal(links.length, 2);
  assert.notEqual(links[0].link, links[1].link);
  assert.notEqual(tokenForPurchasedSet(config, "10001", "20001", 1), tokenForPurchasedSet(config, "10002", "20001", 1));
  assert.equal(new URL(links[0].link).search, "");
  plan.surveys[0].access_token_hash = "replacement";
  assert.throws(() => purchasedSetLinks(job, plan.surveys, config), error => error.permanent && error.code === "survey_link_changed");
});

test("HMAC checks exact raw bytes and rejects malformed signatures", () => {
  const body = Buffer.from('{ "id": 1 }');
  const signature = createHmac("sha256", config.webhookSecret).update(body).digest("base64");
  assert.equal(verifyShopifyHmac(body, signature, config.webhookSecret), true);
  assert.equal(verifyShopifyHmac(Buffer.from('{"id":1}'), signature, config.webhookSecret), false);
  assert.equal(verifyShopifyHmac(body, "", config.webhookSecret), false);
  assert.equal(verifyShopifyHmac({}, signature, config.webhookSecret), false);
});

async function httpFixture(t) {
  const jobs = new Map(); let writes = 0;
  const db = { fail: false, async rpc(name, args) {
    assert.equal(name, "provision_life_letters_paid_order");
    writes++;
    if (this.fail) return { error: { code: "connection_failed" } };
    const key = `${args.p_shop}:${args.p_order_id}`;
    const duplicate = jobs.has(key);
    if (!duplicate) jobs.set(key, args);
    return { data: { duplicate } };
  } };
  const app = express().use(createShopifyWebhookRouter({ db, getConfig: () => config })).use(express.json());
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (payload, headers = {}) => {
    const body = JSON.stringify(payload);
    return fetch(base + "/webhooks/shopify/orders-paid", { method: "POST", headers: {
      "Content-Type": "application/json", "X-Shopify-Shop-Domain": config.shop, "X-Shopify-Topic": "orders/paid",
      "X-Shopify-Webhook-Id": randomUUID(), "X-Shopify-Hmac-Sha256": createHmac("sha256", config.webhookSecret).update(body).digest("base64"), ...headers,
    }, body });
  };
  return { db, jobs, request, writes: () => writes };
}

test("signed paid-order webhook commits once per order and invalid requests never reach storage", async t => {
  const f = await httpFixture(t);
  assert.equal((await f.request(order(), { "X-Shopify-Hmac-Sha256": "bad" })).status, 401);
  assert.equal((await f.request(order(), { "X-Shopify-Shop-Domain": "other.myshopify.com" })).status, 401);
  assert.equal((await f.request(order(), { "X-Shopify-Topic": "orders/create" })).status, 400);
  assert.equal(f.writes(), 0);
  assert.equal((await f.request({ ...order(), financial_status: "pending" })).status, 200);
  assert.equal(f.writes(), 0);
  assert.equal((await f.request(order())).status, 200);
  assert.equal((await (await f.request(order())).json()).duplicate, true);
  assert.equal(f.jobs.size, 1);
  assert.equal([...f.jobs.values()][0].p_surveys.length, 2);
  f.db.fail = true;
  assert.equal((await f.request({ ...order(), id: 10002 })).status, 503);
});

test("email uses frozen order labels, private links, escaped HTML, and a stable provider idempotency key", async () => {
  const job = { id: randomUUID(), customer_email: "parent@example.com", order_reference: "#1001", message: { customerName: "<Parent>" } };
  const links = [{ label: "Set 1", link: "https://survey.example.com/#survey=sample&token=test-only" }];
  const message = surveyEmailMessage(job, links, config);
  assert.match(message.text, /Submit My Life Letters Cards/);
  assert.match(message.html, /&lt;Parent&gt;/);
  assert.equal(message.reply_to, config.replyTo);
  let requests = 0;
  const fetchEmail = async (url, request) => {
    requests++;
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(request.headers["Idempotency-Key"], `life-letters-survey/${job.id}`);
    assert.deepEqual(JSON.parse(request.body).to, ["parent@example.com"]);
    return new Response(JSON.stringify({ id: "email-test" }), { status: 200 });
  };
  assert.equal(await sendSurveyEmail(job, links, config, fetchEmail), "email-test");
  assert.equal(requests, 1);
  await assert.rejects(sendSurveyEmail(job, links, config, async () => new Response("{}", { status: 403 })), error => error.permanent);
  await assert.rejects(sendSurveyEmail(job, links, config, async () => new Response("{}", { status: 429 })), error => !error.permanent);
});

test("email processor records accepted and failed sends without losing jobs or exposing tokens", async () => {
  const plan = paidOrderPlan(order(), config);
  const job = { id: randomUUID(), claim_token: randomUUID(), shopify_order_id: plan.orderId, message: { sets: plan.sets } };
  const finishes = [];
  const db = { from: () => ({ select() { return this; }, in: async () => ({ data: plan.surveys }) }),
    rpc: async (name, args) => name === "claim_life_letters_survey_emails" ? { data: [job] } : (finishes.push(args), { data: true }) };
  await createEmailProcessor({ db, getConfig: () => config, send: async (_job, links) => { assert.equal(links.length, 2); return "accepted-email-id"; } })();
  assert.equal(finishes[0].p_provider_id, "accepted-email-id");
  assert.equal(finishes[0].p_claim_token, job.claim_token);
  await createEmailProcessor({ db, getConfig: () => config, send: async () => { throw new Error("Contains a private token that must not be saved"); } })();
  assert.equal(finishes[1].p_error_code, "email_processing_failed");
  assert.equal(JSON.stringify(finishes).includes("private token"), false);
  let sent = false;
  await createEmailProcessor({ db, getConfig: () => ({ ...config, enabled: false }), send: async () => { sent = true; } })();
  assert.equal(sent, false);
});

test("configuration readiness never reports secret values", () => {
  assert.equal(configurationProblems(config).length, 0);
  const missing = configurationProblems(automationConfig({}));
  assert.ok(missing.includes("Shopify webhook signing secret"));
  assert.ok(missing.includes("Resend email key"));
});
