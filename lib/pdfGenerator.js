import supabase from "./supabase.js";
import { LETTER_HINTS } from "./letterData.js";

/**
 * Launch a Puppeteer browser.
 * Uses PUPPETEER_EXECUTABLE_PATH env var if set (Docker/Render),
 * otherwise uses puppeteer's bundled Chromium (local dev).
 */
async function launchBrowser() {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

  if (executablePath) {
    // Production: use system Chromium via puppeteer-core
    const puppeteerCore = (await import("puppeteer-core")).default;
    return puppeteerCore.launch({
      executablePath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  } else {
    // Local dev: use full puppeteer with bundled Chromium
    const puppeteer = (await import("puppeteer")).default;
    return puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
}

/**
 * Extract just the phonetic symbol from a hint string.
 * e.g. "/a/ like in apple" → "/a/"
 */
function getPhoneticSymbol(letter) {
  const hint = LETTER_HINTS[letter.toUpperCase()] || "";
  const match = hint.match(/^(\/[^/]+\/)/);
  return match ? match[1] : `/${letter.toLowerCase()}/`;
}

/**
 * Fetch an image URL and return a base64 data URI.
 * Falls back to empty string if fetch fails.
 */
async function imageToBase64(url) {
  if (!url) return "";
  try {
    const response = await fetch(url);
    if (!response.ok) return "";
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const base64 = Buffer.from(buffer).toString("base64");
    return `data:${contentType};base64,${base64}`;
  } catch {
    console.error("Failed to fetch image:", url);
    return "";
  }
}

/**
 * Build the full HTML document for all 52 pages (front + back per letter).
 */
function buildHTML(entries, letterStyle) {
  const pages = [];

  for (const entry of entries) {
    const letter = entry.letter.toUpperCase();
    const lower = letter.toLowerCase();
    const word = entry.word;
    const photoDataUri = entry._photoBase64 || "";
    const phoneticSymbol = getPhoneticSymbol(letter);

    // Build front letter display based on customer's style preference
    let letterDisplayHTML;
    if (letterStyle === "lower") {
      letterDisplayHTML = `<span class="letter-single">${lower}</span>`;
    } else if (letterStyle === "upper") {
      letterDisplayHTML = `<span class="letter-single">${letter}</span>`;
    } else {
      // "mix" (default) — uppercase + lowercase side by side
      letterDisplayHTML = `
        <span class="letter-upper">${letter}</span>
        <span class="letter-lower">${lower}</span>`;
    }

    // Build back answer based on style preference
    let answerLetterDisplay;
    if (letterStyle === "upper") {
      answerLetterDisplay = letter;
    } else {
      answerLetterDisplay = lower;
    }

    // --- FRONT PAGE ---
    pages.push(`
      <div class="page front">
        <div class="letter-display">
          ${letterDisplayHTML}
        </div>
        ${
          photoDataUri
            ? `<div class="photo-container">
                <img src="${photoDataUri}" class="photo" />
              </div>`
            : `<div class="photo-container photo-placeholder">
                <div class="placeholder-text">No photo</div>
              </div>`
        }
      </div>
    `);

    // --- BACK PAGE ---
    pages.push(`
      <div class="page back">
        <div class="back-content">
          <p class="prompt">What is the <span class="underline">name</span> of this letter?</p>
          <p class="answer-letter">\u201C${answerLetterDisplay}\u201D</p>
          <p class="prompt">What <span class="underline">sound</span> does this letter make?</p>
          <p class="answer-sound">\u201C${phoneticSymbol} like in ${word}\u201D</p>
        </div>
      </div>
    `);
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&display=swap');

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Nunito', sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .page {
      width: 5in;
      height: 7in;
      page-break-after: always;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: white;
      position: relative;
      overflow: hidden;
    }

    /* ===== FRONT CARD ===== */
    .front {
      padding: 0.3in 0.4in 0.4in;
      justify-content: flex-start;
    }

    .letter-display {
      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: 0.15in;
      margin-top: 0.2in;
      margin-bottom: 0.25in;
    }

    .letter-upper {
      font-size: 2.2in;
      font-weight: 800;
      color: #333;
      line-height: 1;
    }

    .letter-lower {
      font-size: 1.6in;
      font-weight: 700;
      color: #555;
      line-height: 1;
    }

    .letter-single {
      font-size: 2.4in;
      font-weight: 800;
      color: #333;
      line-height: 1;
    }

    .photo-container {
      width: 3.6in;
      height: 3.6in;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      border-radius: 0.08in;
    }

    .photo {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .photo-placeholder {
      background: #f0f0f0;
      border: 2px dashed #ccc;
    }

    .placeholder-text {
      color: #999;
      font-size: 16pt;
    }

    /* ===== BACK CARD ===== */
    .back {
      padding: 0.5in;
    }

    .back-content {
      width: 100%;
      height: 100%;
      border: 2px solid #e0e0e0;
      border-radius: 0.2in;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: space-evenly;
      padding: 0.4in 0.3in;
      text-align: center;
    }

    .prompt {
      font-size: 18pt;
      font-weight: 600;
      color: #444;
      line-height: 1.4;
    }

    .underline {
      text-decoration: underline;
      text-decoration-thickness: 2px;
      text-underline-offset: 3px;
    }

    .answer-letter {
      font-size: 60pt;
      font-weight: 800;
      color: #333;
      line-height: 1.2;
    }

    .answer-sound {
      font-size: 24pt;
      font-weight: 700;
      color: #333;
      line-height: 1.3;
    }
  </style>
</head>
<body>
  ${pages.join("\n")}
</body>
</html>`;
}

/**
 * Generate a PDF for an order and upload it to Supabase Storage.
 *
 * @param {object} order - The order record from the database
 * @param {Array} entries - The 26 letter_entries records, sorted by letter
 * @returns {string|null} The public URL of the uploaded PDF, or null on failure
 */
export async function generateOrderPDF(order, entries) {
  console.log(`[PDF] Generating cards for order ${order.order_number}...`);

  // Pre-fetch all photos as base64
  const enrichedEntries = await Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      _photoBase64: await imageToBase64(entry.photo_url),
    }))
  );

  // Build HTML
  const html = buildHTML(enrichedEntries, order.letter_style);

  // Launch Puppeteer and render PDF
  let browser;
  try {
    browser = await launchBrowser();

    const page = await browser.newPage();

    // Set content and wait for fonts + images to load
    await page.setContent(html, { waitUntil: "networkidle0" });

    // Generate PDF at 5x7 inches
    const pdfBuffer = await page.pdf({
      width: "5in",
      height: "7in",
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
    });

    console.log(
      `[PDF] Rendered ${pdfBuffer.length} bytes for order ${order.order_number}`
    );

    // Upload to Supabase Storage
    if (supabase) {
      const fileName = `order-${order.order_number}.pdf`;
      const storagePath = `orders/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from("order-pdfs")
        .upload(storagePath, pdfBuffer, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (uploadError) {
        console.error("[PDF] Upload error:", uploadError);
        return null;
      }

      // Get public URL
      const {
        data: { publicUrl },
      } = supabase.storage.from("order-pdfs").getPublicUrl(storagePath);

      // Store URL on the order record
      await supabase
        .from("orders")
        .update({ pdf_url: publicUrl, updated_at: new Date().toISOString() })
        .eq("id", order.id);

      console.log(`[PDF] Uploaded to ${publicUrl}`);
      return publicUrl;
    }

    // If no Supabase, return null (PDF was generated but couldn't be stored)
    console.warn("[PDF] No Supabase configured, PDF not stored");
    return null;
  } catch (error) {
    console.error("[PDF] Generation failed:", error);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * Regenerate PDF for an existing order by fetching its data from the database.
 */
export async function regenerateOrderPDF(orderId) {
  if (!supabase) throw new Error("Database not configured");

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderError || !order) throw new Error("Order not found");

  const { data: entries, error: entriesError } = await supabase
    .from("letter_entries")
    .select("*")
    .eq("order_id", orderId)
    .order("letter");

  if (entriesError) throw new Error("Failed to fetch letter entries");

  return generateOrderPDF(order, entries);
}
