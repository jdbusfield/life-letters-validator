import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

function fixture() {
  const classes = new Set();
  const input = { value: "apple", disabled: false, focus() { this.focused = true; } };
  const elements = {
    "input-A": input,
    "word-field-A": { classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); } } },
    "clear-word-A": { hidden: false },
    defaultAllCheckbox: { checked: true },
    validateAllBtn: { disabled: false, innerHTML: "" },
  };
  const context = vm.createContext({
    document: { addEventListener() {}, getElementById(id) { return elements[id]; } },
    console, clearTimeout() {}, setTimeout() {},
  });
  vm.runInContext(source, context);
  vm.runInContext(`
    state.A = {word: "apple", status: "valid", feedback: "Good", isDefault: false, photoUrl: "saved-photo.jpg"};
    updateCardDefault = () => {};
    updateCard = (letter, status) => { lastCardStatus = status; };
    updateSubmitButton = () => { updateWordField("A"); savedWord = state.A.word; };
  `, context);
  return { context, input, elements, classes };
}

test("Clear empties a custom word, preserves its photo, saves, and focuses the field", () => {
  const { context, input, elements } = fixture();
  vm.runInContext('clearLetterWord("A")', context);
  assert.equal(input.value, "");
  assert.equal(input.focused, true);
  assert.equal(elements["clear-word-A"].hidden, true);
  assert.equal(context.savedWord, "");
  assert.equal(vm.runInContext('state.A.photoUrl', context), "saved-photo.jpg");
  assert.equal(vm.runInContext('state.A.status', context), "empty");
});

test("Clear unlocks a default word for replacement", () => {
  const { context, input, elements } = fixture();
  input.disabled = true;
  vm.runInContext('state.A.isDefault = true; clearLetterWord("A")', context);
  assert.equal(input.disabled, false);
  assert.equal(vm.runInContext('state.A.isDefault', context), false);
  assert.equal(elements.defaultAllCheckbox.checked, false);
});

for (const mode of ["single", "batch"]) {
  test(`an in-flight ${mode} validation cannot restore feedback after Clear`, async () => {
    const { context } = fixture();
    let finish;
    context.fetch = () => new Promise(resolve => { finish = resolve; });
    const pending = vm.runInContext(mode === "single" ? 'validateSingle("A", "apple")' : 'validateAll()', context);
    vm.runInContext('clearLetterWord("A")', context);
    const result = { valid: true, message: "Old response", suggestion: "" };
    finish({ ok: true, async json() { return mode === "single" ? result : {results: {A: result}}; } });
    await pending;
    assert.equal(vm.runInContext('state.A.word', context), "");
    assert.equal(vm.runInContext('state.A.status', context), "empty");
    assert.equal(context.lastCardStatus, "empty");
  });
}
