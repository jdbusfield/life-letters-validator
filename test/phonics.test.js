import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CARDS, WORD_SUGGESTIONS } from "../lib/letterData.js";
import { validateSingle, validateBatch } from "../lib/validation.js";

const noAI = { responses: { create() { throw new Error("Reviewed examples must not need AI"); } } };

test("every displayed suggestion and default has a stable accepted verdict", async () => {
  for (const [letter, words] of Object.entries(WORD_SUGGESTIONS)) {
    for (const word of [...words, DEFAULT_CARDS[letter]]) {
      assert.equal((await validateSingle(letter, word, noAI)).valid, true, `${letter}: ${word}`);
    }
  }
});

test("tricky sounds agree in single and batch validation", async () => {
  const cases = [
    ["C", "cat", true], ["C", "city", false], ["G", "gift", true],
    ["G", "girl", true], ["G", "giraffe", false], ["S", "shoes", false],
    ["A", "arm", false], ["E", "eagle", false], ["I", "ice", false],
    ["O", "one", false], ["U", "unicorn", false], ["qu", "queen", true],
    ["Q", "quay", false], ["X", "fox", true], ["X", "six", true],
    ["X", "x-ray", false], ["X", "xylophone", false],
  ];
  for (const [letter, word, expected] of cases) {
    assert.equal((await validateSingle(letter, word, noAI)).valid, expected, word);
    const key = letter === "qu" ? "Q" : letter;
    const batch = await validateBatch([{ letter, word }], noAI);
    assert.equal(batch[key].valid, expected, word);
  }
});

test("custom words still use AI without overriding reviewed batch verdicts", async () => {
  let request;
  const client = { responses: { async create(input) {
    request = input;
    return { status: "completed", output_text: JSON.stringify({
      B: { valid: true, message: "Good starting sound", suggestion: "" },
      X: { valid: true, message: "Unrequested override", suggestion: "" },
    }) };
  } } };
  const batch = await validateBatch([
    { letter: "B", word: "Benny" }, { letter: "G", word: "gift" },
    { letter: "X", word: "x-ray" },
  ], client);
  assert.equal(batch.B.valid, true);
  assert.equal(batch.G.valid, true);
  assert.equal(batch.X.valid, false);
  assert.match(request.input[0].content[0].text, /FINAL \/ks\//);
  assert.match(request.input[1].content, /Benny/);
  assert.doesNotMatch(request.input[1].content, /x-ray|gift/);
});
