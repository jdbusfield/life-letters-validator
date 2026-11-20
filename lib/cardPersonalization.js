import { readFileSync } from "node:fs";

export const CARD_COLORS = Object.freeze(JSON.parse(readFileSync(new URL("../public/card-colors.json", import.meta.url), "utf8")));
const colorIds = new Set(CARD_COLORS.map(color => color.id));

export function cardPersonalization(input, required = false) {
  const childName = input.childName ?? "";
  const cardColor = input.cardColor ?? "";
  if (typeof childName !== "string" || childName.length > 80 || /[\u0000-\u001f\u007f]/u.test(childName)) {
    throw Object.assign(new Error("Enter a child's name of 80 characters or fewer, on one line"), { status: 400 });
  }
  if (typeof cardColor !== "string" || (cardColor !== "" && !colorIds.has(cardColor))) {
    throw Object.assign(new Error("Choose blue, pink, green, orange, or yellow"), { status: 400 });
  }
  if (required && !childName.trim()) throw Object.assign(new Error("Please enter the child's name for the title card"), { status: 422 });
  if (required && !cardColor) throw Object.assign(new Error("Please choose a card color"), { status: 422 });
  return { childName, cardColor };
}
