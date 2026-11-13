import { LETTER_DATA, WORD_SUGGESTIONS, DEFAULT_CARDS } from "./letterData.js";

export const SYSTEM_PROMPT = `You are a phonics expert helping validate words for a children's educational alphabet card product called "Life Letters." Each card teaches a child a letter by pairing it with a photo of something meaningful to them.

Your job: determine if a submitted word/name starts with the CORRECT PHONETIC SOUND for the given letter.

CRITICAL RULES:
1. Except for X, the word must start with the PRIMARY phonetic sound of the letter, as taught to young children (ages 2-5). For X, require a word ending in /ks/, like fox or box.
2. Focus on the SOUND the word starts with, NOT the spelling.
3. Proper names (people, pets, places) are perfectly valid — just check the starting sound.
4. Multi-word phrases like "Daddy" or "alligator from zoo" are fine — check the FIRST word's starting sound (for X, check whether that first word ends in /ks/).
5. For vowels (A, E, I, O, U): require the SHORT vowel sound in apple, egg, itch, octopus, umbrella. Reject long vowels, initial schwa, and r-controlled vowels (arm, earth, irk, orbit, urn). Judge pronunciation, not a blanket spelling rule. Accept ordinary regional pronunciation differences for short vowels; do not reject a word solely because a is followed by m or n.
6. The word should be something a child can understand and that could appear in a photo.

TRICKY CASES TO WATCH FOR:
- G: "giraffe" is INVALID (starts with /j/ sound). "goat" is VALID.
- C: "city" is INVALID (starts with /s/ sound). "cat" is VALID.
- K: "knife" is INVALID (starts with /n/ sound). "kite" is VALID.
- P: "phone" is INVALID (starts with /f/ sound). "pig" is VALID.
- W: "write" is INVALID (starts with /r/ sound). "water" is VALID.
- S: "shoe", "shoes", "ship", "sure", and "sugar" are INVALID (start with /sh/, not /s/). "sun" and "swing" are VALID.
- X: Require a FINAL /ks/ sound. "fox", "box", "mix", "six", "fix", and "x-box" are VALID. "xylophone" (/z/) and "x-ray" (the letter name) are INVALID. A written x alone does not qualify.
- H: "hour" is INVALID (H is silent). "hat" is VALID.
- U: "unicorn" is INVALID (starts with /y/). "umbrella" is VALID.
- QU: "queen", "quilt", "quick" are VALID /kw/. "quay" is INVALID /k/.
- C/G spelling patterns have exceptions: "gift" and "girl" have hard /g/ and are VALID. Check pronunciation rather than banning e/i/y after g.

Respond with ONLY a JSON object (no markdown, no code fences, no extra text):
{
  "valid": true/false,
  "emoji": "checkmark or X emoji",
  "message": "Brief friendly explanation (1 sentence max)",
  "suggestion": "If invalid, suggest 1-2 valid alternatives. If valid, empty string."
}`;

export const MODEL = "gpt-6-luna";

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    valid: { type: "boolean" },
    emoji: { type: "string" },
    message: { type: "string" },
    suggestion: { type: "string" },
  },
  required: ["valid", "emoji", "message", "suggestion"],
  additionalProperties: false,
};

// Incomplete responses and refusals must never become accepted words.
function responseText(response) {
  if (response.status !== "completed") return null;
  const messages = (response.output || []).filter(item => item.type === "message");
  if (messages.some(item => item.content?.some(block => block.type === "refusal"))) return null;
  return (response.output_text ?? messages
    .flatMap(item => item.content || [])
    .filter(block => block.type === "output_text")
    .map(block => block.text)
    .join("")).trim();
}

// The model sometimes writes "checkmark" or "X" as words, so the emoji comes
// from the verdict rather than the model's text.
function withEmoji(result) {
  return { ...result, emoji: result.valid ? "✅" : "❌" };
}

function parseJsonResponse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isVerdict(result) {
  return result && typeof result.valid === "boolean" &&
    typeof result.message === "string" && typeof result.suggestion === "string";
}

function retryVerdict() {
  return {
    valid: false,
    emoji: "\u26A0\uFE0F",
    message: "Could not validate. Please try again.",
    suggestion: "",
  };
}

async function requestVerdict(client, prompt, schema, name, maxOutputTokens) {
  const resolvedClient = typeof client === "function" ? client() : client;
  const response = await resolvedClient.responses.create({
    model: MODEL,
    store: false,
    reasoning: { effort: "low" },
    max_output_tokens: maxOutputTokens,
    // Cache only the shared phonics guidance, not customer-submitted words.
    prompt_cache_options: { mode: "explicit" },
    input: [
      { role: "developer", content: [{
        type: "input_text",
        text: SYSTEM_PROMPT,
        prompt_cache_breakpoint: { mode: "explicit" },
      }] },
      { role: "user", content: prompt },
    ],
    text: {
      verbosity: "low",
      format: { type: "json_schema", name, strict: true, schema },
    },
  });
  return parseJsonResponse(responseText(response));
}

// Reviewed examples have stable verdicts in both single and batch validation.
// Unlisted custom words/names still use the phonics model.
const INVALID_EXAMPLES = {
  A: ["acorn", "apron", "angel", "about", "arm", "art"],
  C: ["city", "celery", "circle", "cycle", "chair"],
  E: ["eagle", "earth", "ear"],
  G: ["giraffe", "gem", "giant", "george", "gym"],
  H: ["hour", "honest", "heir"],
  I: ["ice", "island", "iron", "irk"],
  K: ["knife", "knee", "knight", "know"],
  O: ["oval", "orbit", "one", "once"],
  P: ["phone", "photo", "psalm", "pterodactyl"],
  Q: ["quay"],
  S: ["shoe", "shoes", "ship", "sure", "sugar"],
  T: ["the", "think"],
  U: ["unicorn", "uniform", "ukulele", "urn", "urchin"],
  W: ["write", "wrong", "wreck", "wrist"],
  X: ["xylophone", "x-ray", "xray", "taxi", "saxophone"],
};

function normalizeLetter(letter) {
  const key = String(letter).toUpperCase();
  return key === "QU" ? "Q" : key;
}

function referenceVerdict(letter, word) {
  const text = word.trim().toLowerCase();
  const approved = [...WORD_SUGGESTIONS[letter], DEFAULT_CARDS[letter]];
  if (approved.some(example => example.toLowerCase() === text)) {
    return withEmoji({valid: true, message: `Great choice! This matches ${LETTER_DATA[letter].sound}.`, suggestion: ""});
  }
  if (INVALID_EXAMPLES[letter]?.includes(text)) {
    return withEmoji({valid: false, message: `Try a word with ${LETTER_DATA[letter].sound}.`, suggestion: WORD_SUGGESTIONS[letter].slice(0, 2).join(" or ")});
  }
  return null;
}

export async function validateSingle(letter, word, client) {
  const upperLetter = normalizeLetter(letter);
  const letterInfo = LETTER_DATA[upperLetter];

  if (!letterInfo) {
    throw new Error("Invalid letter");
  }

  const reviewed = referenceVerdict(upperLetter, word);
  if (reviewed) return reviewed;

  const userPrompt = `Letter: ${upperLetter}
Primary sound: ${letterInfo.sound}
Standard example: ${letterInfo.example}
${letterInfo.avoid ? `Known issues to avoid: ${letterInfo.avoid}` : ""}

Word submitted: "${word.trim()}"

Is this word valid for the letter ${upperLetter}?`;

  const result = await requestVerdict(client, userPrompt, VERDICT_SCHEMA, "phonics_verdict", 2048);
  if (!isVerdict(result)) return retryVerdict();

  return withEmoji(result);
}

export async function validateBatch(entries, client) {
  const validEntries = entries
    .filter(e => e.word && e.word.trim().length > 0)
    .map(e => ({...e, letter: normalizeLetter(e.letter)}));
  const reviewed = {};
  const pending = validEntries.filter(e => {
    if (!LETTER_DATA[e.letter]) throw new Error("Invalid letter");
    const verdict = referenceVerdict(e.letter, e.word);
    if (verdict) reviewed[e.letter] = verdict;
    return !verdict;
  });

  if (validEntries.length === 0) {
    return {};
  }

  if (pending.length === 0) return reviewed;

  const entriesText = pending
    .map((e) => {
      const info = LETTER_DATA[e.letter.toUpperCase()];
      return `- Letter ${e.letter.toUpperCase()} (sound: ${info.sound}${info.avoid ? `, avoid: ${info.avoid}` : ""}): "${e.word.trim()}"`;
    })
    .join("\n");

  const batchPrompt = `Validate each of these words for their respective letters. For each one, check the correct phonetic sound (at the START, except X requires final /ks/).

${entriesText}

Respond with ONLY a JSON object (no markdown, no code fences, no extra text) mapping each letter to its result:
{
  "A": {"valid": true/false, "emoji": "...", "message": "...", "suggestion": "..."},
  "B": {"valid": true/false, "emoji": "...", "message": "...", "suggestion": "..."}
}

Include ONLY the letters listed above.`;

  const letters = [...new Set(pending.map(entry => entry.letter))];
  const schema = {
    type: "object",
    properties: Object.fromEntries(letters.map(letter => [letter, VERDICT_SCHEMA])),
    required: letters,
    additionalProperties: false,
  };
  const results = await requestVerdict(client, batchPrompt, schema, "phonics_batch", 16000);
  return { ...reviewed, ...Object.fromEntries(
    letters.map(letter => [letter, isVerdict(results?.[letter])
      ? withEmoji(results[letter]) : retryVerdict()])
  ) };
}
