import { LETTER_DATA } from "./letterData.js";

export const SYSTEM_PROMPT = `You are a phonics expert helping validate words for a children's educational alphabet card product called "Life Letters." Each card teaches a child a letter by pairing it with a photo of something meaningful to them.

Your job: determine if a submitted word/name starts with the CORRECT PHONETIC SOUND for the given letter.

CRITICAL RULES:
1. The word must start with the PRIMARY phonetic sound of the letter, as taught to young children (ages 2-5).
2. Focus on the SOUND the word starts with, NOT the spelling.
3. Proper names (people, pets, places) are perfectly valid — just check the starting sound.
4. Multi-word phrases like "Daddy" or "alligator from zoo" are fine — check the FIRST word's starting sound.
5. For vowels (A, E, I, O, U): avoid words where the vowel is followed by R as the next consonant, because this creates an R-controlled vowel that changes the sound (e.g., "art" for A, "earth" for E, "orange" for O).
6. The word should be something a child can understand and that could appear in a photo.

TRICKY CASES TO WATCH FOR:
- G: "giraffe" is INVALID (starts with /j/ sound). "goat" is VALID.
- C: "city" is INVALID (starts with /s/ sound). "cat" is VALID.
- K: "knife" is INVALID (starts with /n/ sound). "kite" is VALID.
- P: "phone" is INVALID (starts with /f/ sound). "pig" is VALID.
- W: "write" is INVALID (starts with /r/ sound). "water" is VALID.
- S: "shoe" is borderline (starts with /sh/ digraph, not pure /s/). "sun" is VALID.
- X: This is special — very few words start with /ks/. Accept words starting with X even if pronounced /z/ like "xylophone", but flag it. "x-ray" is ideal.
- H: "hour" is INVALID (H is silent). "hat" is VALID.
- U: "unicorn" is borderline (starts with /y/ sound). "umbrella" is VALID.

Respond with ONLY a JSON object (no markdown, no code fences, no extra text):
{
  "valid": true/false,
  "emoji": "checkmark or X emoji",
  "message": "Brief friendly explanation (1 sentence max)",
  "suggestion": "If invalid, suggest 1-2 valid alternatives. If valid, empty string."
}`;

function parseJsonResponse(text) {
  try {
    return JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return null;
  }
}

export async function validateSingle(letter, word, client) {
  const upperLetter = letter.toUpperCase();
  const letterInfo = LETTER_DATA[upperLetter];

  if (!letterInfo) {
    throw new Error("Invalid letter");
  }

  const userPrompt = `Letter: ${upperLetter}
Primary sound: ${letterInfo.sound}
Standard example: ${letterInfo.example}
${letterInfo.avoid ? `Known issues to avoid: ${letterInfo.avoid}` : ""}

Word submitted: "${word.trim()}"

Is this word valid for the letter ${upperLetter}?`;

  const response = await client.chat.completions.create({
    model: "deepseek-chat",
    max_tokens: 256,
    temperature: 0.1,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });

  const text = response.choices[0].message.content.trim();
  const result = parseJsonResponse(text);

  if (!result) {
    return {
      valid: false,
      emoji: "\u26A0\uFE0F",
      message: "Could not validate. Please try again.",
      suggestion: "",
    };
  }

  return result;
}

export async function validateBatch(entries, client) {
  const validEntries = entries.filter(
    (e) => e.word && e.word.trim().length > 0
  );

  if (validEntries.length === 0) {
    return {};
  }

  const entriesText = validEntries
    .map((e) => {
      const info = LETTER_DATA[e.letter.toUpperCase()];
      return `- Letter ${e.letter.toUpperCase()} (sound: ${info.sound}${info.avoid ? `, avoid: ${info.avoid}` : ""}): "${e.word.trim()}"`;
    })
    .join("\n");

  const batchPrompt = `Validate each of these words for their respective letters. For each one, check if the word starts with the correct phonetic sound for that letter.

${entriesText}

Respond with ONLY a JSON object (no markdown, no code fences, no extra text) mapping each letter to its result:
{
  "A": {"valid": true/false, "emoji": "...", "message": "...", "suggestion": "..."},
  "B": {"valid": true/false, "emoji": "...", "message": "...", "suggestion": "..."}
}

Include ONLY the letters listed above.`;

  const response = await client.chat.completions.create({
    model: "deepseek-chat",
    max_tokens: 4096,
    temperature: 0.1,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: batchPrompt },
    ],
  });

  const text = response.choices[0].message.content.trim();
  const results = parseJsonResponse(text);
  return results || {};
}
