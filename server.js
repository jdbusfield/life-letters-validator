import OpenAI from "openai";
import express from "express";
import multer from "multer";
import { fileURLToPath } from "url";
import { dirname, join, extname } from "path";
import { existsSync, mkdirSync } from "fs";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from the project directory (not CWD)
dotenv.config({ path: join(__dirname, ".env") });

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// ---- Photo Upload Setup ----
const uploadsDir = join(__dirname, "uploads");
if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });

// Serve uploaded files
app.use("/uploads", express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const letter = (req.params.letter || "X").toUpperCase();
    const ext = extname(file.originalname).toLowerCase() || ".jpg";
    // Overwrite any previous upload for this letter
    cb(null, `letter-${letter}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|heic|heif)$/i;
    if (allowed.test(extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error("Only image files (JPG, PNG, GIF, WebP, HEIC) are allowed"));
    }
  },
});

// Upload a photo for a specific letter
app.post("/api/upload/:letter", upload.single("photo"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    const letter = req.params.letter.toUpperCase();
    res.json({
      success: true,
      letter,
      filename: req.file.filename,
      url: `/uploads/${req.file.filename}`,
      size: req.file.size,
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ error: error.message });
  }
});

// Multer error handler
app.use((err, _req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "File too large. Maximum size is 10 MB." });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

// DeepSeek uses OpenAI-compatible API
const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

// Phonetic data for each letter - primary sound, example, and known tricky cases
const LETTER_DATA = {
  A: {
    sound: "/a/ (short a as in apple)",
    example: "apple",
    avoid: "words where A is followed by R (like 'art', 'arm') because it changes the vowel sound",
  },
  B: { sound: "/b/ (as in ball)", example: "ball", avoid: "" },
  C: {
    sound: "/k/ (hard C as in cat)",
    example: "cat",
    avoid: "soft C words like 'city', 'circle', 'celery' (those start with an /s/ sound)",
  },
  D: { sound: "/d/ (as in dog)", example: "dog", avoid: "" },
  E: {
    sound: "/e/ (short e as in elephant)",
    example: "elephant",
    avoid: "words where E is followed by R (like 'earth', 'ear') because it changes the vowel sound",
  },
  F: { sound: "/f/ (as in fish)", example: "fish", avoid: "" },
  G: {
    sound: "/g/ (hard G as in go)",
    example: "goat",
    avoid: "soft G words like 'giraffe', 'gem', 'giant', 'George' (those start with a /j/ sound)",
  },
  H: {
    sound: "/h/ (as in hat)",
    example: "hat",
    avoid: "silent H words like 'hour', 'honest', 'heir'",
  },
  I: {
    sound: "/i/ (short i as in igloo)",
    example: "igloo",
    avoid: "words where I is followed by R (like 'iron', 'ire') because it changes the vowel sound. Also avoid long-I words like 'ice' or 'island' for young learners",
  },
  J: { sound: "/j/ (as in jump)", example: "jump", avoid: "" },
  K: {
    sound: "/k/ (as in kite)",
    example: "kite",
    avoid: "silent K words like 'knife', 'knee', 'knight', 'know'",
  },
  L: { sound: "/l/ (as in lion)", example: "lion", avoid: "" },
  M: { sound: "/m/ (as in moon)", example: "moon", avoid: "" },
  N: { sound: "/n/ (as in nest)", example: "nest", avoid: "" },
  O: {
    sound: "/o/ (short o as in octopus)",
    example: "octopus",
    avoid: "words where O is followed by R (like 'orange', 'orbit') because it changes the vowel sound. Also avoid words starting with 'one' or 'once' (start with /w/ sound)",
  },
  P: {
    sound: "/p/ (as in pig)",
    example: "pig",
    avoid: "'ph' words like 'phone', 'photo' (those start with /f/ sound), and silent P words like 'psalm', 'pneumonia', 'pterodactyl'",
  },
  Q: {
    sound: "/kw/ (as in queen)",
    example: "queen",
    avoid: "",
  },
  R: { sound: "/r/ (as in rain)", example: "rain", avoid: "" },
  S: {
    sound: "/s/ (as in sun)",
    example: "sun",
    avoid: "'sh' words like 'shoe', 'ship' (those start with /sh/ sound) and words where S sounds like /z/ like 'sure'",
  },
  T: {
    sound: "/t/ (as in tiger)",
    example: "tiger",
    avoid: "'th' words like 'the', 'think' (those start with /th/ sound)",
  },
  U: {
    sound: "/u/ (short u as in umbrella)",
    example: "umbrella",
    avoid: "words where U is followed by R (like 'urchin') because it changes the vowel sound. Also avoid words starting with 'uni-' (start with /y/ sound)",
  },
  V: { sound: "/v/ (as in van)", example: "van", avoid: "" },
  W: {
    sound: "/w/ (as in water)",
    example: "water",
    avoid: "silent W words like 'write', 'wrong', 'wreck', 'wrist'",
  },
  X: {
    sound: "/ks/ (as in box) — note: very few English words start with the /ks/ sound",
    example: "x-ray or fox",
    avoid: "words like 'xylophone' (starts with /z/ sound). For X, the word just needs to prominently feature the X sound or start with X",
  },
  Y: { sound: "/y/ (as in yellow)", example: "yellow", avoid: "" },
  Z: { sound: "/z/ (as in zebra)", example: "zebra", avoid: "" },
};

const SYSTEM_PROMPT = `You are a phonics expert helping validate words for a children's educational alphabet card product called "Life Letters." Each card teaches a child a letter by pairing it with a photo of something meaningful to them.

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

// Validate a single word for a letter
app.post("/api/validate", async (req, res) => {
  try {
    const { letter, word } = req.body;

    if (!letter || !word) {
      return res.status(400).json({ error: "Letter and word are required" });
    }

    const upperLetter = letter.toUpperCase();
    const letterInfo = LETTER_DATA[upperLetter];

    if (!letterInfo) {
      return res.status(400).json({ error: "Invalid letter" });
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

    // Parse JSON response
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      // If it didn't return clean JSON, try to extract it
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        result = {
          valid: false,
          emoji: "\u26A0\uFE0F",
          message: "Could not validate. Please try again.",
          suggestion: "",
        };
      }
    }

    res.json(result);
  } catch (error) {
    console.error("Validation error:", error);
    res.status(500).json({
      error: "Validation failed",
      message: error.message,
    });
  }
});

// Batch validate multiple words at once
app.post("/api/validate-batch", async (req, res) => {
  try {
    const { entries } = req.body; // [{letter: "A", word: "apple"}, ...]

    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: "Entries array is required" });
    }

    // Filter to only non-empty entries
    const validEntries = entries.filter(
      (e) => e.word && e.word.trim().length > 0
    );

    if (validEntries.length === 0) {
      return res.json({ results: {} });
    }

    // Build a single prompt for batch validation
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
    let results;
    try {
      results = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        results = JSON.parse(jsonMatch[0]);
      } else {
        results = {};
      }
    }

    res.json({ results });
  } catch (error) {
    console.error("Batch validation error:", error);
    res.status(500).json({
      error: "Batch validation failed",
      message: error.message,
    });
  }
});

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
  console.log(
    `\n  Life Letters Validator running at http://localhost:${PORT}\n`
  );
});
