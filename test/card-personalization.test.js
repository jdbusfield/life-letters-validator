import test from "node:test";
import assert from "node:assert/strict";
import { CARD_COLORS, cardPersonalization } from "../lib/cardPersonalization.js";
import { safeDraft } from "../lib/surveyData.js";

test("incomplete drafts save, but submission requires the child's name and an offered color", () => {
  assert.deepEqual(cardPersonalization({}), { childName: "", cardColor: "" });
  assert.throws(() => cardPersonalization({ childName: " \t", cardColor: "pink" }, true));
  assert.throws(() => cardPersonalization({ childName: "Jo" }, true), /choose a card color/);
  for (const color of CARD_COLORS) assert.equal(cardPersonalization({ childName: "Jo", cardColor: color.id }, true).cardColor, color.id);
  assert.throws(() => cardPersonalization({ childName: "Jo", cardColor: "purple" }), /Choose blue/);
});

test("personalization preserves names and ignores arbitrary preview colors supplied by a client", () => {
  const childName = "Éloïse-Jane O’Neil";
  const survey = { id: "test", customer_email: "parent@example.com", order_reference: "#123" };
  const draft = safeDraft({ childName, cardColor: "yellow", colorHex: "#000000", letters: {} }, survey);
  assert.equal(draft.childName, childName);
  assert.equal(draft.cardColor, "yellow");
  assert.equal(draft.colorHex, undefined);
  assert.throws(() => cardPersonalization({ childName: "Jo\n<script>" }), /one line/);
  assert.throws(() => cardPersonalization({ childName: "x".repeat(81) }), /80 characters/);
});
