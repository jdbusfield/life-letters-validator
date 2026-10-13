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
  if (!text) return null;
  // Strip markdown code fences the model sometimes adds despite instructions.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

const MAX_ATTEMPTS = 3;

// Call the model and parse its JSON reply, retrying when the API call throws
// or the reply is empty/unparseable/missing required fields. The model
// occasionally returns malformed JSON (e.g. unescaped quotes in "message") or
// an empty body, which used to surface as "Could not validate" on perfectly
// good words.
async function completeJson(client, request, isUsable, label) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await client.chat.completions.create({
        ...request,
        response_format: { type: "json_object" },
      });
      const text = (response.choices?.[0]?.message?.content || "").trim();
      const result = parseJsonResponse(text);
      if (result && isUsable(result)) return result;
      console.warn(
        `[validation] ${label}: unusable model reply (attempt ${attempt}/${MAX_ATTEMPTS}):`,
        JSON.stringify(text).slice(0, 500)
      );
    } catch (err) {
      lastError = err;
      console.warn(
        `[validation] ${label}: API error (attempt ${attempt}/${MAX_ATTEMPTS}):`,
        err.message
      );
    }
  }
  if (lastError) throw lastError;
  return null;
}

function isSingleResult(r) {
  return r && typeof r === "object" && typeof r.valid === "boolean";
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

  const result = await completeJson(
    client,
    {
      model: "deepseek-chat",
      max_tokens: 256,
      temperature: 0.1,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    },
    isSingleResult,
    `${upperLetter}/${word.trim()}`
  );

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

  const results = await completeJson(
    client,
    {
      model: "deepseek-chat",
      max_tokens: 4096,
      temperature: 0.1,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: batchPrompt },
      ],
    },
    (r) => r && typeof r === "object" && !Array.isArray(r),
    "batch"
  );
  return results || {};
}
