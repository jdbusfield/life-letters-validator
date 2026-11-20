import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { submissionAlertConfig, submissionAlertProblems, submissionAlertMessage, sendSubmissionAlert,
  createSubmissionAlertProcessor, createSubmissionAlertAdminRouter } from "../lib/submissionAlerts.js";

const config = { enabled: true, recipient: "owner@example.com", emailKey: "test-only-key",
  emailFrom: "Life Letters <cards@example.com>", baseUrl: "https://survey.example.com" };
const job = { id: "test-job", claim_token: "test-claim", recipient_email: "owner@example.com",
  order_reference: "#1003", set_label: "Set 2", created_at: "2026-11-17T12:00:00Z" };

test("alerts contain the reference and authenticated admin link, with no customer photos or private survey tokens", () => {
  const message = submissionAlertMessage({ ...job, order_reference: "<order>\r\nBcc: bad@example.com", set_label: "<set>",
    customer_email: "parent@example.com", access_token: "private-token", photo_url: "https://example.com/private-photo" }, config);
  assert.deepEqual(message.to, ["owner@example.com"]);
  assert.match(message.text, /https:\/\/survey.example.com\/admin/);
  assert.match(message.text, /latest survey status/);
  assert.match(message.html, /&lt;set&gt;/);
  assert.doesNotMatch(message.html, /<set>|<order>/);
  assert.doesNotMatch(message.subject, /[\r\n]/);
  assert.doesNotMatch(JSON.stringify(message), /parent@example.com|private-token|private-photo|attachments/);
});

test("notifications freeze the queue recipient and use the same provider idempotency key on retries", async () => {
  let calls = 0;
  const send = async (url, request) => {
    calls++;
    assert.equal(url, "https://api.resend.com/emails");
    assert.equal(request.headers["Idempotency-Key"], "life-letters-submission/test-job");
    assert.deepEqual(JSON.parse(request.body).to, ["owner@example.com"]);
    return new Response('{"id":"accepted"}', { status: 200 });
  };
  assert.equal(await sendSubmissionAlert(job, { ...config, recipient: "new-owner@example.com" }, send), "accepted");
  await sendSubmissionAlert(job, config, send);
  assert.equal(calls, 2);
  await assert.rejects(sendSubmissionAlert({ ...job, recipient_email: "bad\r\naddress" }, config, send), e => e.permanent);
  assert.equal(calls, 2);
});

test("provider failures are classified for retries without leaking server errors", async () => {
  for (const [status, permanent] of [[403, true], [429, false], [500, false]]) {
    await assert.rejects(sendSubmissionAlert(job, config, async () => new Response("{}", { status })), e => e.code === `notification_http_${status}` && e.permanent === permanent);
  }
  await assert.rejects(sendSubmissionAlert(job, config, async () => { throw Error("secret credential"); }), e => e.code === "notification_request_unconfirmed" && !e.message.includes("secret"));
});

test("processor records acceptance and safe failures, respects disabled setup, and prevents overlapping polls", async () => {
  const finishes = []; let claims = 0;
  const db = { async rpc(name, args) {
    if (name === "claim_life_letters_submission_alerts") { claims++; assert.equal(args.p_recipient, config.recipient); return { data: [job] }; }
    assert.equal(name, "finish_life_letters_submission_alert"); finishes.push(args); return { data: true };
  } };
  let release;
  const processor = createSubmissionAlertProcessor({ db, getConfig: () => config,
    send: () => new Promise(resolve => { release = resolve; }) });
  const pending = processor();
  await Promise.resolve(); await processor();
  assert.equal(claims, 1); release("accepted"); await pending;
  assert.equal(finishes[0].p_provider_id, "accepted");
  assert.equal(finishes[0].p_claim_token, job.claim_token);
  await createSubmissionAlertProcessor({ db, getConfig: () => config, send: async () => { throw Error("private token or secret"); } })();
  assert.equal(finishes[1].p_error_code, "notification_processing_failed");
  assert.doesNotMatch(JSON.stringify(finishes), /private token/);
  for (const change of [{ enabled: false }, { recipient: "" }, { emailKey: "" }, { baseUrl: "http://example.com" }]) {
    await createSubmissionAlertProcessor({ db, getConfig: () => ({ ...config, ...change }), send: async () => assert.fail("Must not send") })();
  }
  assert.equal(claims, 2);
});

test("admin status requires authentication and never returns credentials", async t => {
  let dbReads = 0;
  const db = { from: () => ({ select() { dbReads++; return this; }, order() { return this; }, async limit() { return { data: [{ order_reference: "#1003", status: "sent" }] }; } }) };
  const app = express().use((req, _res, next) => { req.session = { isAdmin: req.get("X-Test-Admin") === "yes" }; next(); })
    .use(createSubmissionAlertAdminRouter({ db, getConfig: () => config }));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/admin/submission-alerts`;
  assert.equal((await fetch(url)).status, 401); assert.equal(dbReads, 0);
  const response = await fetch(url, { headers: { "X-Test-Admin": "yes" } });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const result = await response.json();
  assert.equal(result.recipient, config.recipient); assert.equal(result.jobs[0].status, "sent");
  assert.doesNotMatch(JSON.stringify(result), /test-only-key/);
});

test("configuration is disabled by default and readiness only describes missing settings", () => {
  assert.equal(submissionAlertConfig({}).enabled, false);
  assert.deepEqual(submissionAlertProblems(config), []);
  assert.ok(submissionAlertProblems(submissionAlertConfig({})).includes("Notification email address"));
});
