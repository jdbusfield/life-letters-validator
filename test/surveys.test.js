import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import express from "express";
import { createSurveyRouter } from "../routes/surveys.js";
import { hashToken, makeSurveyRows, safeDraft, LETTERS } from "../lib/surveyData.js";
import { memoryDatabase } from "./survey-fixture.js";
import uploadRoutes from "../routes/upload.js";

async function fixture(t, options = {}) {
  const db = memoryDatabase();
  const app = express().use(express.json()).use((req, _res, next) => { req.session = { isAdmin: req.headers["x-test-admin"] === "yes" }; next(); })
    .use(uploadRoutes)
    .use(createSurveyRouter({ db, generatePDF: async () => {}, validate: async entries => Object.fromEntries(entries.map(e => [e.letter, { valid: true }])), ...options }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body, { admin = false, cookie, method = body ? "POST" : "GET", origin } = {}) => fetch(base + path, {
    method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(admin ? { "x-test-admin": "yes" } : {}), ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const create = async (setCount = 2) => {
    const response = await request("/api/admin/surveys", { customerEmail: "parent@example.com", customerName: "Parent", orderReference: "TEST-1", setCount, requestId: randomUUID() }, { admin: true });
    assert.equal(response.status, 201);
    return (await response.json()).surveys.map(item => ({ ...item, token: new URLSearchParams(new URL(item.link).hash.slice(1)).get("token") }));
  };
  const login = async item => {
    const response = await request(`/api/surveys/${item.id}/session`, { token: item.token });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  };
  const title = item => {const id=randomUUID(),path=`surveys/${item.id}/TITLE/${id}.jpg`;db.tables.survey_photos.push({id,survey_id:item.id,letter:"TITLE",storage_path:path,content_type:"image/jpeg"});return {storagePath:path,position:{x:25,y:65}};};
  return { db, base, request, create, login, title };
}

test("one purchase of two sets creates isolated random private links; plaintext tokens are not stored", () => {
  const items = makeSurveyRows({ customerEmail: "parent@example.com", customerName: "Parent", orderReference: "#1001", setCount: 2, requestId: randomUUID() }, "https://survey.example.com");
  assert.equal(items.length, 2);
  assert.notEqual(items[0].row.id, items[1].row.id);
  assert.notEqual(items[0].link, items[1].link);
  const token = new URLSearchParams(new URL(items[0].link).hash.slice(1)).get("token");
  assert.equal(items[0].row.access_token_hash, hashToken(token));
  assert.equal(JSON.stringify(items[0].row).includes(token), false);
  assert.equal(new URL(items[0].link).search, "");
});

test("production access gate blocks legacy uploads without intercepting config, admin, or private routes", async t => {
  const previous = process.env.REQUIRE_SURVEY_ACCESS;
  process.env.REQUIRE_SURVEY_ACCESS = "true";
  t.after(() => { if (previous === undefined) delete process.env.REQUIRE_SURVEY_ACCESS; else process.env.REQUIRE_SURVEY_ACCESS = previous; });
  const f = await fixture(t);
  const config = await f.request("/api/survey-config");
  assert.equal(config.status, 200);
  assert.equal((await config.json()).accessRequired, true);
  assert.equal((await f.request("/api/upload/A", {})).status, 401);
  const [a] = await f.create(1), cookie = await f.login(a);
  assert.equal((await f.request(`/api/surveys/${a.id}`, null, { cookie })).status, 200);
  assert.equal((await f.request("/api/admin/surveys", null, { admin: true })).status, 200);
});

test("draft normalization rejects cross-survey photos and ignores customer identity/URLs supplied by the browser", () => {
  const survey = { id: randomUUID(), customer_email: "owner@example.com", order_reference: "#1001" };
  const input = { customerName: "Parent", customerEmail: "attacker@example.com", letters: { A: { word: "apple", isDefault: false, storagePath: "someone-elses/photo.jpg" } } };
  assert.throws(() => safeDraft(input, survey, []), /does not belong/);
  input.letters.A.storagePath = null;
  input.letters.A.photoUrl = "http://127.0.0.1/private";
  const draft = safeDraft(input, survey, []);
  assert.equal(draft.customerEmail, survey.customer_email);
  assert.equal(draft.letters.A.photoUrl, null);
});

test("unauthenticated clients cannot provision/read surveys; each cookie is scoped to one set", async t => {
  const f = await fixture(t);
  assert.equal((await f.request("/api/admin/surveys")).status, 401);
  const [a, b] = await f.create();
  assert.equal((await f.request(`/api/surveys/${a.id}`)).status, 401);
  const response = await f.request(`/api/surveys/${a.id}/session`, { token: a.token });
  assert.match(response.headers.get("set-cookie"), new RegExp(`Path=/api/surveys/${a.id}`));
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  const cookie = await f.login(a);
  const own = await f.request(`/api/surveys/${a.id}`, null, { cookie });
  assert.equal(own.status, 200);
  assert.equal(JSON.stringify(await own.json()).includes("access_token_hash"), false);
  assert.equal((await f.request(`/api/surveys/${b.id}`, null, { cookie })).status, 401);
  assert.equal((await f.request(`/api/surveys/${a.id}/session`, { token: b.token })).status, 401);
});

test("saved words restore on another device and stale writes cannot overwrite a newer revision", async t => {
  const f = await fixture(t), [a] = await f.create(1), cookie = await f.login(a);
  const draft = { customerName: "Parent", childName: "Éloïse-Jane", cardColor: "pink", setLabel: "Oliver", letters: { A: { word: "apple", isDefault: true } } };
  const save = () => f.request(`/api/surveys/${a.id}`, { revision: 0, draft }, { method: "PUT", cookie });
  assert.equal((await save()).status, 200);
  assert.equal((await save()).status, 409);
  const secondDevice = await f.login(a);
  const loaded = await (await f.request(`/api/surveys/${a.id}`, null, { cookie: secondDevice })).json();
  assert.equal(loaded.draft.letters.A.word, "apple");
  assert.equal(loaded.revision, 1);
  assert.equal(loaded.setLabel, "Oliver");
  assert.equal(loaded.draft.childName, "Éloïse-Jane");
  assert.equal(loaded.draft.cardColor, "pink");
});

test("expired, revoked and cross-origin sessions are rejected", async t => {
  const f = await fixture(t), [a] = await f.create(1);
  assert.equal((await f.request(`/api/surveys/${a.id}/session`, { token: a.token }, { origin: "https://unrelated.example" })).status, 403);
  f.db.tables.surveys[0].expires_at = "2020-01-01T00:00:00Z";
  assert.equal((await f.request(`/api/surveys/${a.id}/session`, { token: a.token })).status, 401);
  f.db.tables.surveys[0].expires_at = "2099-01-01T00:00:00Z";
  f.db.tables.surveys[0].revoked_at = new Date().toISOString();
  assert.equal((await f.request(`/api/surveys/${a.id}/session`, { token: a.token })).status, 401);
});

test("private photo uploads are isolated and only the owner or administrator can read them", async t => {
  const f = await fixture(t), [a, b] = await f.create(), cookieA = await f.login(a), cookieB = await f.login(b);
  await f.request(`/api/surveys/${a.id}`, { revision: 0, draft: { customerName: "Parent", photoPermissionAccepted: true, photoPermissionVersion: "2026-11-18-v1", letters: {} } }, { method: "PUT", cookie: cookieA });
  const form = new FormData();
  form.append("photo", new Blob([await readFile(new URL("../public/defaults/A.jpg", import.meta.url))], { type: "image/jpeg" }), "apple.jpg");
  const response = await fetch(`${f.base}/api/surveys/${a.id}/photos/A`, { method: "POST", headers: { cookie: cookieA }, body: form });
  assert.equal(response.status, 200);
  const photo = await response.json();
  assert.match(photo.storagePath, new RegExp(`^surveys/${a.id}/A/`));
  assert.equal((await f.request(photo.url)).status, 401);
  assert.equal((await f.request(photo.url, null, { cookie: cookieB })).status, 401);
  const own = await f.request(photo.url, null, { cookie: cookieA });
  assert.equal(own.status, 200);
  assert.match(own.headers.get("cache-control"), /no-store/);
  assert.equal((await f.request(photo.url, null, { admin: true })).status, 200);
  const otherPath = photo.url.replace(a.id, b.id);
  assert.equal((await f.request(otherPath, null, { cookie: cookieB })).status, 404);
});

test("submitting is idempotent, locks edits, and never trusts client validation flags", async t => {
  let validated = false;
  const f = await fixture(t, { validate: async entries => { validated = true; assert.equal(entries.length, 0); return {}; } });
  const [a] = await f.create(1), cookie = await f.login(a);
  const draft = { customerName: "Parent", childName: "Jo", cardColor: "green", photoPermissionAccepted: true, photoPermissionVersion: "2026-11-18-v1", letters: Object.fromEntries(LETTERS.map(letter => [letter, { word: "ignored", isDefault: true }])) };
  draft.childPhoto=f.title(a);
  assert.equal((await f.request(`/api/surveys/${a.id}`, { revision: 0, draft }, { method: "PUT", cookie })).status, 200);
  const submit = () => f.request(`/api/surveys/${a.id}/submit`, { revision: 1 }, { cookie });
  const responses = await Promise.all([submit(), submit()]);
  assert.equal(responses[0].status, 200);
  assert.equal(responses[1].status, 200);
  assert.equal(f.db.tables.orders.length, 1);
  assert.equal(f.db.tables.letter_entries.length, 26);
  assert.equal(validated, true);
  assert.equal((await f.request(`/api/surveys/${a.id}`, { revision: 2, draft }, { method: "PUT", cookie })).status, 409);
});

test("a custom word without an owned photo cannot be submitted even if the browser marks it valid", async t => {
  const f = await fixture(t), [a] = await f.create(1), cookie = await f.login(a);
  const draft = { customerName: "Parent", childName: "Jo", cardColor: "blue", photoPermissionAccepted: true, photoPermissionVersion: "2026-11-18-v1", letters: Object.fromEntries(LETTERS.map(letter => [letter, { word: "apple", isDefault: true }])) };
  draft.childPhoto=f.title(a);
  draft.letters.A = { word: "apple", isDefault: false, status: "valid" };
  await f.request(`/api/surveys/${a.id}`, { revision: 0, draft }, { method: "PUT", cookie });
  assert.equal((await f.request(`/api/surveys/${a.id}/submit`, { revision: 1 }, { cookie })).status, 422);
  assert.equal(f.db.tables.orders.length, 0);
});

test("an earlier browser cannot submit without the new required details, and sets keep separate choices", async t => {
  const f = await fixture(t), [a, b] = await f.create(), cookieA = await f.login(a), cookieB = await f.login(b);
  const letters = Object.fromEntries(LETTERS.map(letter => [letter, { isDefault: true }]));
  const oldDraft = { customerName: "Parent", letters };
  await f.request(`/api/surveys/${a.id}`, { revision: 0, draft: oldDraft }, { method: "PUT", cookie: cookieA });
  const missing = await f.request(`/api/surveys/${a.id}/submit`, { revision: 1 }, { cookie: cookieA });
  assert.equal(missing.status, 422);
  assert.match((await missing.json()).error, /child's name/);
  assert.equal(f.db.tables.orders.length, 0);
  for (const [item, cookie, revision, childName, cardColor] of [[a,cookieA,1,"Ava","pink"],[b,cookieB,0,"Leo","blue"]]) {
    const response = await f.request(`/api/surveys/${item.id}`, { revision, draft: { ...oldDraft, childName, cardColor } }, { method: "PUT", cookie });
    assert.equal(response.status, 200);
    const loaded = await (await f.request(`/api/surveys/${item.id}`, null, { cookie })).json();
    assert.equal(loaded.draft.childName, childName);
    assert.equal(loaded.draft.cardColor, cardColor);
  }
});

test("server phonics rejection blocks an owned-photo submission despite a forged valid flag", async t => {
  const f = await fixture(t, { validate: async entries => {
    assert.deepEqual(entries, [{ letter: "G", word: "giraffe" }]);
    return { G: { valid: false, reason: "Use the hard g sound" } };
  } });
  const [a] = await f.create(1), cookie = await f.login(a);
  const photoId = randomUUID(), path = `surveys/${a.id}/G/${photoId}.jpg`;
  f.db.tables.survey_photos.push({ id: photoId, survey_id: a.id, letter: "G", storage_path: path, content_type: "image/jpeg" });
  const draft = { customerName: "Parent", childName: "Jo", cardColor: "blue", photoPermissionAccepted: true, photoPermissionVersion: "2026-11-18-v1", letters: Object.fromEntries(LETTERS.map(letter => [letter, { isDefault: true }])) };
  draft.childPhoto=f.title(a);
  draft.letters.G = { word: "giraffe", isDefault: false, storagePath: path, status: "valid" };
  assert.equal((await f.request(`/api/surveys/${a.id}`, { revision: 0, draft }, { method: "PUT", cookie })).status, 200);
  const response = await f.request(`/api/surveys/${a.id}/submit`, { revision: 1 }, { cookie });
  assert.equal(response.status, 422);
  assert.equal((await response.json()).results.G.valid, false);
  assert.equal(f.db.tables.orders.length, 0);
  assert.equal(f.db.tables.surveys[0].status, "draft");
});

test("replacing a private link revokes old sessions and preserves the saved draft", async t => {
  const previous = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = "https://survey.example.com";
  t.after(() => { if (previous === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = previous; });
  const f = await fixture(t), [a] = await f.create(1), oldCookie = await f.login(a);
  const response = await f.request(`/api/admin/surveys/${a.id}/link`, {}, { admin: true });
  assert.equal(response.status, 200);
  const token = new URLSearchParams(new URL((await response.json()).link).hash.slice(1)).get("token");
  assert.notEqual(token, a.token);
  assert.equal((await f.request(`/api/surveys/${a.id}`, null, { cookie: oldCookie })).status, 401);
  assert.equal((await f.request(`/api/surveys/${a.id}/session`, { token: a.token })).status, 401);
  const newCookie = await f.login({ ...a, token });
  assert.equal((await f.request(`/api/surveys/${a.id}`, null, { cookie: newCookie })).status, 200);
  assert.equal(f.db.tables.surveys.length, 1);
});

test("photo permission is recorded by the server, restored on another device and required before buffering uploads",async t=>{
  const f=await fixture(t),[a]=await f.create(1),cookie=await f.login(a);
  assert.equal((await f.request(`/api/surveys/${a.id}/photos/A`,{}, {cookie})).status,422);
  const draft={customerName:"Parent",photoPermissionAccepted:true,photoPermissionVersion:"2026-11-18-v1",photo_permission_at:"forged",letters:{}};
  assert.equal((await f.request(`/api/surveys/${a.id}`,{revision:0,draft:{...draft,photoPermissionVersion:"old-notice"}},{cookie,method:"PUT"})).status,422);
  assert.equal(f.db.tables.surveys[0].photo_permission_at,undefined);
  assert.equal((await f.request(`/api/surveys/${a.id}`,{revision:0,draft},{cookie,method:"PUT"})).status,200);
  assert.notEqual(f.db.tables.surveys[0].photo_permission_at,"forged");
  const loaded=await(await f.request(`/api/surveys/${a.id}`,null,{cookie:await f.login(a)})).json();
  assert.equal(loaded.draft.photoPermissionAccepted,true);
  assert.equal((await f.request(`/api/surveys/${a.id}/photos/A`,{}, {cookie})).status,400);
  await f.request(`/api/surveys/${a.id}`,{revision:1,draft:{...draft,photoPermissionAccepted:false}},{cookie,method:"PUT"});
  assert.equal((await f.request(`/api/surveys/${a.id}/photos/A`,{}, {cookie})).status,422);
});

test("private links and admin photo access cannot recover a purging or erased set",async t=>{
  const previous=process.env.PUBLIC_BASE_URL;process.env.PUBLIC_BASE_URL="https://survey.example.com";
  t.after(()=>{if(previous===undefined)delete process.env.PUBLIC_BASE_URL;else process.env.PUBLIC_BASE_URL=previous;});
  const f=await fixture(t),[a]=await f.create(1),cookie=await f.login(a);
  f.db.tables.surveys[0].personalization_purging_at=new Date().toISOString();
  assert.equal((await f.request(`/api/surveys/${a.id}`,null,{cookie})).status,410);
  assert.equal((await f.request(`/api/surveys/${a.id}/photos/${randomUUID()}`,null,{admin:true})).status,410);
  assert.equal((await f.request(`/api/admin/surveys/${a.id}/link`,{},{admin:true})).status,410);
  assert.equal((await f.request(`/api/surveys/${a.id}`)).status,401);
});

test("a dedicated child photo is required, uploads privately and restores its framing on another device",async t=>{
  const f=await fixture(t),[a,b]=await f.create(),cookie=await f.login(a);
  const draft={customerName:"Parent",childName:"Alexandria-Josephine",cardColor:"blue",photoPermissionAccepted:true,photoPermissionVersion:"2026-11-18-v1",letters:Object.fromEntries(LETTERS.map(letter=>[letter,{isDefault:true}]))};
  await f.request(`/api/surveys/${a.id}`,{revision:0,draft},{method:"PUT",cookie});
  const missing=await f.request(`/api/surveys/${a.id}/submit`,{revision:1},{cookie});
  assert.equal(missing.status,422);assert.match((await missing.json()).error,/child's photo/);assert.equal(f.db.tables.orders.length,0);
  const form=new FormData();form.append("photo",new Blob([await readFile(new URL("../public/defaults/J.jpg",import.meta.url))],{type:"image/jpeg"}),"sample-child.jpg");
  const uploaded=await fetch(`${f.base}/api/surveys/${a.id}/photos/TITLE`,{method:"POST",headers:{cookie},body:form});assert.equal(uploaded.status,200);
  const photo=await uploaded.json();assert.match(photo.storagePath,new RegExp(`^surveys/${a.id}/TITLE/`));
  draft.childPhoto={storagePath:photo.storagePath,photoUrl:"https://wrong.example",position:{x:20,y:75}};
  assert.equal((await f.request(`/api/surveys/${a.id}`,{revision:1,draft},{method:"PUT",cookie})).status,200);
  const restored=await(await f.request(`/api/surveys/${a.id}`,null,{cookie:await f.login(a)})).json();assert.equal(restored.draft.childPhoto.photoUrl,photo.url);assert.deepEqual(restored.draft.childPhoto.position,{x:20,y:75});
  assert.equal((await f.request(photo.url,null,{cookie:await f.login(b)})).status,401);
  assert.equal((await f.request(`/api/surveys/${a.id}/submit`,{revision:2},{cookie})).status,200);
  assert.equal(f.db.tables.orders[0].child_photo_storage_path,photo.storagePath);assert.deepEqual(f.db.tables.orders[0].child_photo_position,{x:20,y:75});
});
