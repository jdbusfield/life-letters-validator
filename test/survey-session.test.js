import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/survey-session.js", import.meta.url), "utf8");
const id = "11111111-1111-4111-8111-111111111111";
function fixture(write) {
  const calls = [], notices = [];
  const context = vm.createContext({ URLSearchParams, structuredClone,
    location: { hash: `#survey=${id}&token=${"a".repeat(43)}`, search: "" },
    history: { replaceState(_state, _title, url) { context.replacedUrl = url; } },
    window: { addEventListener() {} },
    document: { getElementById() { return { set textContent(value) { notices.push(value); }, classList: { toggle() {} } }; } },
    fetch: async (path, options = {}) => {
      calls.push({ path, ...options });
      if (options.method === "PUT") return write(JSON.parse(options.body), calls);
      const data = path === "/api/survey-config" ? { accessRequired: true }
        : path.endsWith("/session") ? { success: true }
        : { id, revision: 0, status: "draft", draft: { letters: {} } };
      return { ok: true, json: async () => data };
    },
  });
  vm.runInContext(source, context);
  return { context, calls, notices, open: () => context.window.LifeLettersSurvey.open() };
}
const ok = revision => ({ ok: true, json: async () => ({ revision }) });

test("email token is exchanged once and removed from the address; subsequent requests use the cookie", async () => {
  const f = fixture();
  await f.open();
  assert.equal(f.replacedUrl, undefined);
  assert.equal(f.context.replacedUrl, `/?survey=${id}`);
  assert.equal(f.calls[1].path, `/api/surveys/${id}/session`);
  assert.equal(f.calls[2].body, undefined);
  assert.equal(f.calls[2].credentials, "same-origin");
});

test("queued autosaves send the latest edit after the earlier save, with the new revision", async () => {
  let finish;
  const writes = [];
  const f = fixture(body => {
    writes.push(body);
    if (writes.length === 1) return new Promise(resolve => { finish = resolve; });
    return ok(2);
  });
  const session = await f.open();
  const first = session.save({ name: "first" });
  const draft = { name: "second" };
  const second = session.save(draft);
  draft.name = "mutated afterwards";
  finish(ok(1));
  await Promise.all([first, second]);
  assert.deepEqual(writes.map(write => write.revision), [0, 1]);
  assert.equal(writes[1].draft.name, "second");
  assert.equal(session.revision, 2);
  assert.equal(session.pending, null);
});

test("a stale-version conflict is visible and pauses writes instead of silently overwriting another device", async () => {
  let writes = 0;
  const f = fixture(() => { writes++; return { ok: false, status: 409, json: async () => ({ error: "Changed on another device. Reload." }) }; });
  const session = await f.open();
  await assert.rejects(session.save({ word: "apple" }), /another device/);
  await assert.rejects(session.save({ word: "alligator" }), /another device/);
  assert.equal(writes, 1);
  assert.equal(session.pending.word, "alligator");
  assert.match(f.notices.at(-1), /another device/);
});

test("a network failure keeps edits available for an explicit save retry", async () => {
  let writes = 0;
  const f = fixture(() => { if (++writes === 1) throw new Error("Offline. Keep this tab open."); return ok(1); });
  const session = await f.open();
  await assert.rejects(session.save({ word: "apple" }), /Offline/);
  assert.equal(session.pending.word, "apple");
  await session.flush();
  assert.equal(session.revision, 1);
  assert.equal(writes, 2);
});

test("different sets use different local backup keys", async () => {
  const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const context = vm.createContext({ document: { addEventListener() {} } });
  vm.runInContext(appSource, context);
  vm.runInContext('surveySession={active:true,id:"first-set"}', context);
  const first = vm.runInContext("progressKey()", context);
  vm.runInContext('surveySession={active:true,id:"second-set"}', context);
  assert.notEqual(first, vm.runInContext("progressKey()", context));
});

test("a removed set clears only its own device backup",async()=>{
  const f=fixture(()=>({ok:false,status:410,json:async()=>({error:"Personalization removed"})}));
  const removed=[];f.context.localStorage={removeItem:key=>removed.push(key)};
  const session=await f.open();
  await assert.rejects(session.save({word:"apple"}),/removed/);
  assert.deepEqual(removed,[`lifeLetters:survey:${id}`]);
});
