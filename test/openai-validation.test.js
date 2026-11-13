import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import OpenAI from "openai";
import apiRoutes from "../routes/api.js";
import { MODEL, validateSingle, validateBatch } from "../lib/validation.js";

const verdict = { valid: true, emoji: "checkmark", message: "Correct starting sound.", suggestion: "" };
const completed = result => ({ status: "completed", output_text: JSON.stringify(result) });
const fakeClient = response => ({ responses: { async create() { return response; } } });

test("custom words reach OpenAI Responses through the real SDK with the strict verdict contract", async () => {
  let request;
  const client = new OpenAI({
    apiKey: "local-test-key",
    fetch: async (url, options) => {
      request = { url: String(url), headers: new Headers(options.headers), body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        id: "resp_local_test", object: "response", status: "completed", model: MODEL,
        output: [{ type: "message", role: "assistant", content: [{
          type: "output_text", text: JSON.stringify(verdict), annotations: [],
        }] }],
      }), { headers: { "Content-Type": "application/json" } });
    },
  });
  assert.deepEqual(await validateSingle("G", "goose", client), { ...verdict, emoji: "✅" });
  assert.equal(request.url, "https://api.openai.com/v1/responses");
  assert.equal(request.headers.get("authorization"), "Bearer local-test-key");
  assert.equal(request.body.model, MODEL);
  assert.equal(request.body.store, false);
  assert.deepEqual(request.body.reasoning, { effort: "low" });
  assert.equal(request.body.max_output_tokens, 2048);
  assert.equal(request.body.text.verbosity, "low");
  assert.equal(request.body.text.format.type, "json_schema");
  assert.equal(request.body.text.format.strict, true);
  assert.equal(request.body.text.format.schema.additionalProperties, false);
  assert.deepEqual(request.body.text.format.schema.required, ["valid", "emoji", "message", "suggestion"]);
  assert.match(request.body.input[0].content[0].text, /short vowel|SHORT vowel/);
  assert.deepEqual(request.body.input[0].content[0].prompt_cache_breakpoint, { mode: "explicit" });
  assert.deepEqual(request.body.prompt_cache_options, { mode: "explicit" });
  assert.equal(request.body.input[1].content.includes("goose"), true);
  assert.equal(request.body.input[1].prompt_cache_breakpoint, undefined);
  for (const legacyField of ["system", "messages", "max_tokens", "output_config"]) {
    assert.equal(legacyField in request.body, false, legacyField);
  }
});

test("typed text output is read without treating reasoning as a verdict", async () => {
  const response = { status: "completed", output: [
    { type: "reasoning", summary: [{ type: "summary_text", text: "not JSON" }] },
    { type: "message", content: [{ type: "output_text", text: JSON.stringify(verdict) }] },
  ] };
  assert.equal((await validateSingle("G", "goose", fakeClient(response))).valid, true);
});

test("incomplete, refused, malformed and incorrectly typed results never accept a word", async () => {
  const responses = [
    { ...completed(verdict), status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
    { ...completed(verdict), status: "failed" },
    { ...completed(verdict), output: [{ type: "message", content: [{ type: "refusal", refusal: "Declined" }] }] },
    { status: "completed", output_text: "not JSON" },
    completed({ ...verdict, valid: "false" }),
    completed({ valid: true }),
    completed(null),
  ];
  for (const response of responses) {
    const result = await validateSingle("G", "goose", fakeClient(response));
    assert.equal(result.valid, false);
    assert.equal(result.emoji, "⚠️");
    assert.match(result.message, /try again/i);
  }
});

test("batch schemas cover only pending letters and cannot overwrite reviewed words", async () => {
  let request;
  const client = { responses: { async create(body) {
    request = body;
    return completed({ B: verdict, X: verdict });
  } } };
  const results = await validateBatch([
    { letter: "B", word: "Benny" }, { letter: "G", word: "goose" },
    { letter: "X", word: "x-ray" }, { letter: "qu", word: "queen" },
  ], client);
  assert.deepEqual(request.text.format.schema.required, ["B", "G"]);
  assert.deepEqual(Object.keys(request.text.format.schema.properties), ["B", "G"]);
  assert.equal(request.text.format.schema.additionalProperties, false);
  assert.equal(request.max_output_tokens, 16000);
  assert.equal(results.B.valid, true);
  assert.equal(results.G.valid, false);
  assert.equal(results.G.emoji, "⚠️");
  assert.equal(results.X.valid, false);
  assert.equal(results.Q.valid, true);
});

test("batch refusal preserves reviewed verdicts and supplies retries for every custom word", async () => {
  const results = await validateBatch([
    { letter: "B", word: "Benny" }, { letter: "G", word: "goose" }, { letter: "C", word: "cat" },
  ], fakeClient({ status: "completed", output: [{ type: "message", content: [{ type: "refusal" }] }] }));
  assert.equal(results.C.valid, true);
  for (const letter of ["B", "G"]) {
    assert.equal(results[letter].valid, false);
    assert.equal(results[letter].emoji, "⚠️");
  }
});

test("provider failures propagate instead of accepting unchecked custom words", async () => {
  const failure = new Error("temporary upstream failure");
  const client = { responses: { async create() { throw failure; } } };
  await assert.rejects(validateSingle("G", "goose", client), error => error === failure);
  await assert.rejects(validateBatch([{ letter: "G", word: "goose" }], client), error => error === failure);
});

test("HTTP routes validate reviewed examples without credentials and safely reject unconfigured custom checks", async t => {
  const previousKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  t.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  });
  const app = express().use(express.json()).use(apiRoutes);
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body) => fetch(base + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const single = await post("/api/validate", { letter: "G", word: "gift" });
  assert.equal(single.status, 200);
  assert.equal((await single.json()).valid, true);
  const batch = await post("/api/validate-batch", { entries: [
    { letter: "qu", word: "queen" }, { letter: "X", word: "x-ray" },
  ] });
  assert.equal(batch.status, 200);
  const { results } = await batch.json();
  assert.equal(results.Q.valid, true);
  assert.equal(results.X.valid, false);
  for (const [path, body] of [
    ["/api/validate", { letter: "G", word: "goose" }],
    ["/api/validate-batch", { entries: [{ letter: "G", word: "goose" }] }],
  ]) {
    const custom = await post(path, body);
    assert.equal(custom.status, 500);
    const error = await custom.json();
    assert.match(error.message, /try again/i);
    assert.doesNotMatch(JSON.stringify(error), /OPENAI_API_KEY|sk-|upstream/i);
  }
});
