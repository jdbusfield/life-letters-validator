import { Router } from "express";
import OpenAI from "openai";
import { readdirSync } from "fs";
import { join, dirname, extname, basename } from "path";
import { fileURLToPath } from "url";
import supabase from "../lib/supabase.js";
import {
  LETTER_DATA,
  DEFAULT_CARDS,
  WORD_SUGGESTIONS,
  R_WARNING_LETTERS,
  LETTER_HINTS,
  LETTER_TIPS,
  PHONICS_VERSION,
} from "../lib/letterData.js";
import { validateSingle, validateBatch } from "../lib/validation.js";
import { generateOrderPDF } from "../lib/pdfGenerator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULTS_DIR = join(__dirname, "..", "public", "defaults");

// Scan public/defaults/ and return a { A: "/defaults/A.png", ... } map of the
// letters that currently have a stock default image. Re-scanned per request so
// newly dropped-in images appear without a restart.
function getDefaultImageMap() {
  const map = {};
  const allowed = new Set([".png", ".jpg", ".jpeg", ".webp"]);
  try {
    for (const file of readdirSync(DEFAULTS_DIR)) {
      const ext = extname(file).toLowerCase();
      if (!allowed.has(ext)) continue;
      const letter = basename(file, ext).toUpperCase();
      if (/^[A-Z]$/.test(letter) && !map[letter]) {
        map[letter] = `/defaults/${file}`;
      }
    }
  } catch {
    // defaults dir missing — no stock images yet
  }
  return map;
}

const router = Router();

// Construct the client only for custom words that actually need an API check.
let client = null;
function getClient() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is not set");
    }
    client = new OpenAI({ timeout: 30_000, maxRetries: 1 });
  }
  return client;
}

// GET /api/letter-data — return all letter reference data to the frontend
router.get("/api/letter-data", (_req, res) => {
  res.json({
    letterData: LETTER_DATA,
    defaultCards: DEFAULT_CARDS,
    wordSuggestions: WORD_SUGGESTIONS,
    rWarningLetters: [...R_WARNING_LETTERS],
    letterHints: LETTER_HINTS,
    letterTips: LETTER_TIPS,
    phonicsVersion: PHONICS_VERSION,
    defaultImages: getDefaultImageMap(),
  });
});

// POST /api/validate — validate a single word
router.post("/api/validate", async (req, res) => {
  try {
    const { letter, word } = req.body;

    if (!letter || !word) {
      return res.status(400).json({ error: "Letter and word are required" });
    }

    const result = await validateSingle(letter, word, getClient);
    res.json(result);
  } catch (error) {
    console.error("Validation error:", { name: error.name, status: error.status });
    res.status(500).json({
      error: "Validation failed",
      message: "Could not check this word right now. Please try again.",
    });
  }
});

// POST /api/validate-batch — validate multiple words at once
router.post("/api/validate-batch", async (req, res) => {
  try {
    const { entries } = req.body;

    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: "Entries array is required" });
    }

    const results = await validateBatch(entries, getClient);
    res.json({ results });
  } catch (error) {
    console.error("Batch validation error:", { name: error.name, status: error.status });
    res.status(500).json({
      error: "Batch validation failed",
      message: "Could not check these words right now. Please try again.",
    });
  }
});

// POST /api/submit-order — submit completed form to Supabase
router.post("/api/submit-order", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const { orderNumber, customerEmail, customerName, entries } =
      req.body;

    if (!customerEmail) {
      return res
        .status(400)
        .json({ error: "Email is required" });
    }

    const finalOrderNumber =
      (orderNumber && orderNumber.trim()) ||
      `LL-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

    if (!entries || !Array.isArray(entries) || entries.length !== 26) {
      return res
        .status(400)
        .json({ error: "All 26 letter entries are required" });
    }

    // Insert order
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert({
        order_number: finalOrderNumber,
        customer_email: customerEmail,
        customer_name: customerName || null,
        letter_style: "lower",
        status: "submitted",
      })
      .select()
      .single();

    if (orderError) {
      console.error("Order insert error:", orderError);
      if (orderError.code === "23505") {
        return res
          .status(409)
          .json({ error: "This order has already been submitted" });
      }
      return res.status(500).json({ error: "Failed to create order" });
    }

    // Insert letter entries
    const letterEntries = entries.map((e) => ({
      order_id: order.id,
      letter: e.letter.toUpperCase(),
      // Older open tabs may still send the previous default label.
      word: e.isDefault ? DEFAULT_CARDS[e.letter.toUpperCase()] : e.word,
      is_default: e.isDefault || false,
      photo_url: e.photoUrl || null,
      photo_storage_path: e.photoStoragePath || null,
      validation_status: e.validationStatus || "pending",
    }));

    const { error: entriesError } = await supabase
      .from("letter_entries")
      .insert(letterEntries);

    if (entriesError) {
      console.error("Letter entries insert error:", entriesError);
      // Clean up the order if entries fail
      await supabase.from("orders").delete().eq("id", order.id);
      return res.status(500).json({ error: "Failed to save letter entries" });
    }

    // Fire off PDF generation asynchronously (don't block the response)
    generateOrderPDF(order, letterEntries).catch((err) =>
      console.error("Background PDF generation failed:", err)
    );

    res.json({
      success: true,
      orderId: order.id,
      orderNumber: order.order_number,
    });
  } catch (error) {
    console.error("Submit order error:", error);
    res.status(500).json({ error: "Failed to submit order" });
  }
});

// GET /api/order-status/:orderNumber — check order status
router.get("/api/order-status/:orderNumber", async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const { data: order, error } = await supabase
      .from("orders")
      .select("order_number, status, created_at")
      .eq("order_number", req.params.orderNumber)
      .single();

    if (error || !order) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json(order);
  } catch (error) {
    console.error("Order status error:", error);
    res.status(500).json({ error: "Failed to get order status" });
  }
});

export default router;
