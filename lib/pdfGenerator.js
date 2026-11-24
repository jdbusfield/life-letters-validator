import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import supabase from "./supabase.js";
import { preparePrintPhoto } from "./printPhoto.js";
import { LETTER_HINTS } from "./letterData.js";
import { PHOTO_BUCKET, PDF_BUCKET } from "./surveyData.js";
import { withPrivatePdfLease, requirePersonalizationAvailable } from "./photoPrivacy.js";
import { renderInProcess } from "./pdfProcess.js";
import {enqueuePrivatePDF} from './pdfQueue.js';
import {privatePdfPath} from './privatePdfPath.js';
import { BLUE_TEMPLATE, bluePilotRequested, verifyBlueTemplate, renderBlueDesignerDeck } from "./designerBlueDeck.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Card dimensions: 4.25 x 5.5 inches (in PDF points, 1 inch = 72 points)
const CARD_W = 4.25 * 72; // 306
const CARD_H = 5.5 * 72; // 396

// Colors
const DARK = rgb(0.2, 0.2, 0.2); // #333
const MED = rgb(0.33, 0.33, 0.33); // #555
const LIGHT_GRAY = rgb(0.27, 0.27, 0.27); // #444
const BORDER_COLOR = rgb(0.88, 0.88, 0.88); // #e0e0e0
const PLACEHOLDER_BG = rgb(0.94, 0.94, 0.94); // #f0f0f0

/**
 * Load the Nunito font bytes. Falls back to Helvetica if file not found.
 */
let _nunitoFontBytes = null;
function getNunitoFontBytes() {
  if (_nunitoFontBytes !== null) return _nunitoFontBytes;
  try {
    const fontPath = join(__dirname, "fonts", "Nunito-Variable.ttf");
    _nunitoFontBytes = readFileSync(fontPath);
  } catch {
    console.warn("[PDF] Nunito font not found, will use Helvetica");
    _nunitoFontBytes = false;
  }
  return _nunitoFontBytes;
}

/**
 * Extract just the phonetic symbol from a hint string.
 */
function getPhoneticSymbol(letter) {
  const hint = LETTER_HINTS[letter.toUpperCase()] || "";
  const match = hint.match(/^(\/[^/]+\/)/);
  return match ? match[1] : `/${letter.toLowerCase()}/`;
}

/**
 * Fetch an image and return its bytes + type.
 */
async function fetchImageBytes(url) {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/jpeg";
    return { bytes: new Uint8Array(arrayBuffer), contentType };
  } catch {
    console.error("[PDF] Failed to fetch image:", url);
    return null;
  }
}

/**
 * Load the stock "default" photo for a letter from public/defaults/.
 * Looks for <LETTER>.png|jpg|jpeg|webp (e.g. public/defaults/A.png).
 * Returns null if no default image has been added for that letter yet.
 */
const DEFAULTS_DIR = join(__dirname, "..", "public", "defaults");
let blueTemplatePromise;
async function loadBlueTemplate() {
  if (!blueTemplatePromise) blueTemplatePromise = (async () => {
    const { data,error } = await supabase.storage.from(BLUE_TEMPLATE.bucket).download(BLUE_TEMPLATE.path);
    if (error || !data) throw Error("The blue designer template is unavailable");
    return verifyBlueTemplate(new Uint8Array(await data.arrayBuffer()));
  })().catch(error => { blueTemplatePromise=null; throw error; });
  return blueTemplatePromise;
}
function loadDefaultImageBytes(letter) {
  const base = letter.toUpperCase();
  const candidates = [
    [`${base}.png`, "image/png"],
    [`${base}.jpg`, "image/jpeg"],
    [`${base}.jpeg`, "image/jpeg"],
    [`${base}.webp`, "image/webp"],
  ];
  for (const [name, contentType] of candidates) {
    try {
      const bytes = readFileSync(join(DEFAULTS_DIR, name));
      return { bytes: new Uint8Array(bytes), contentType };
    } catch {
      // try next extension
    }
  }
  return null;
}

/**
 * Draw centered text on a page at a given Y position.
 */
function drawCentered(page, text, font, fontSize, y, color = DARK) {
  const textWidth = font.widthOfTextAtSize(text, fontSize);
  const x = (CARD_W - textWidth) / 2;
  page.drawText(text, { x, y, size: fontSize, font, color });
}

/**
 * Draw a rounded rectangle border (no fill).
 */
function drawRoundedRect(page, x, y, w, h, radius, borderColor, borderWidth = 1.5) {
  // pdf-lib doesn't have built-in rounded rects, so draw a regular rect
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    borderColor,
    borderWidth,
    color: undefined,
    opacity: 0,
  });
}

/**
 * Draw the FRONT page for a letter card.
 */
async function drawFrontPage(pdfDoc, font, entry, letterStyle) {
  const page = pdfDoc.addPage([CARD_W, CARD_H]);
  const letter = entry.letter.toUpperCase();
  const lower = letter === "Q" ? "qu" : letter.toLowerCase();

  // --- Photo area ---
  // Generous non-square box so portrait and landscape photos both fit fully
  // without being cropped. Sits in the lower portion of the card; the letter
  // sits in the band above it.
  const photoBoxX = 18;
  const photoBoxY = 22;
  const photoBoxW = CARD_W - 36;     // 270
  const photoBoxH = 232;             // leaves a clear band above for the letter

  // --- Letter display in the band above the photo ---
  // Baseline sits centered in the space between the top edge and the photo box.
  const bandTop = CARD_H - 24;
  const bandBottom = photoBoxY + photoBoxH;
  const letterBaseline = bandBottom + (bandTop - bandBottom) * 0.32;

  if (letterStyle === "lower") {
    drawCentered(page, lower, font, 110, letterBaseline, DARK);
  } else if (letterStyle === "upper") {
    drawCentered(page, letter, font, 110, letterBaseline, DARK);
  } else {
    // "mix" — uppercase + lowercase side by side
    const upperSize = 100;
    const lowerSize = 76;
    const upperW = font.widthOfTextAtSize(letter, upperSize);
    const lowerW = font.widthOfTextAtSize(lower, lowerSize);
    const gap = 8;
    const totalW = upperW + gap + lowerW;
    const startX = (CARD_W - totalW) / 2;

    page.drawText(letter, {
      x: startX,
      y: letterBaseline,
      size: upperSize,
      font,
      color: DARK,
    });
    page.drawText(lower, {
      x: startX + upperW + gap,
      y: letterBaseline + 6,
      size: lowerSize,
      font,
      color: MED,
    });
  }

  if (entry._imageData) {
    try {
      let image;
      if (entry._imageData.contentType.includes("png")) {
        image = await pdfDoc.embedPng(entry._imageData.bytes);
      } else {
        image = await pdfDoc.embedJpg(entry._imageData.bytes);
      }

      // Fit-inside (contain): show the full photo, preserve aspect ratio,
      // never crop. Center within the photo box.
      const imgAspect = image.width / image.height;
      const boxAspect = photoBoxW / photoBoxH;
      let drawW, drawH;
      if (imgAspect > boxAspect) {
        drawW = photoBoxW;
        drawH = photoBoxW / imgAspect;
      } else {
        drawH = photoBoxH;
        drawW = photoBoxH * imgAspect;
      }
      const drawX = photoBoxX + (photoBoxW - drawW) / 2;
      const drawY = photoBoxY + (photoBoxH - drawH) / 2;

      page.drawImage(image, { x: drawX, y: drawY, width: drawW, height: drawH });
    } catch (err) {
      console.error(`[PDF] Failed to embed image for letter ${letter}:`, err.message);
      page.drawRectangle({ x: photoBoxX, y: photoBoxY, width: photoBoxW, height: photoBoxH, color: PLACEHOLDER_BG });
      drawCentered(page, "Photo error", font, 14, photoBoxY + photoBoxH / 2 - 7, MED);
    }
  } else {
    // Placeholder box
    page.drawRectangle({ x: photoBoxX, y: photoBoxY, width: photoBoxW, height: photoBoxH, color: PLACEHOLDER_BG });
    drawCentered(page, "No photo", font, 14, photoBoxY + photoBoxH / 2 - 7, MED);
  }

  return page;
}

/**
 * Draw the BACK page for a letter card.
 */
function drawBackPage(pdfDoc, font, entry, letterStyle) {
  const page = pdfDoc.addPage([CARD_W, CARD_H]);
  const letter = entry.letter.toUpperCase();
  const lower = letter === "Q" ? "qu" : letter.toLowerCase();
  const word = entry.word;
  const phoneticSymbol = getPhoneticSymbol(letter);
  const answerLetter = letterStyle === "upper" ? letter : lower;

  // Border rectangle (inset from edges)
  const margin = 28; // ~0.39 inch
  const rectX = margin;
  const rectY = margin;
  const rectW = CARD_W - margin * 2;
  const rectH = CARD_H - margin * 2;

  drawRoundedRect(page, rectX, rectY, rectW, rectH, 12, BORDER_COLOR, 1.5);

  // Content is evenly spaced vertically inside the border
  const contentTop = CARD_H - margin - 38;
  const contentBottom = margin + 24;
  const totalSpace = contentTop - contentBottom;
  const spacing = totalSpace / 4;

  const promptSize = 14;

  // Line 1: "What is the name of this letter?"
  const nameY = contentTop - spacing * 0.5;
  drawCentered(page, "What is the name of this", font, promptSize, nameY + 12, LIGHT_GRAY);
  drawCentered(page, "letter?", font, promptSize, nameY - 6, LIGHT_GRAY);

  // Underline "name" manually
  const line1Text = "What is the name of this";
  const line1W = font.widthOfTextAtSize(line1Text, promptSize);
  const line1X = (CARD_W - line1W) / 2;
  const beforeName = font.widthOfTextAtSize("What is the ", promptSize);
  const nameW = font.widthOfTextAtSize("name", promptSize);
  page.drawLine({
    start: { x: line1X + beforeName, y: nameY + 10 },
    end: { x: line1X + beforeName + nameW, y: nameY + 10 },
    thickness: 1.5,
    color: LIGHT_GRAY,
  });

  // Line 2: Big quoted letter
  const letterY = contentTop - spacing * 1.5;
  drawCentered(page, `\u201C${answerLetter}\u201D`, font, 50, letterY - 8, DARK);

  // Line 3: "What sound does this letter make?"
  const soundY = contentTop - spacing * 2.5;
  drawCentered(page, "What sound does this letter", font, promptSize, soundY + 12, LIGHT_GRAY);
  drawCentered(page, "make?", font, promptSize, soundY - 6, LIGHT_GRAY);

  // Underline "sound"
  const line3Text = "What sound does this letter";
  const line3W = font.widthOfTextAtSize(line3Text, promptSize);
  const line3X = (CARD_W - line3W) / 2;
  const beforeSound = font.widthOfTextAtSize("What ", promptSize);
  const soundW = font.widthOfTextAtSize("sound", promptSize);
  page.drawLine({
    start: { x: line3X + beforeSound, y: soundY + 10 },
    end: { x: line3X + beforeSound + soundW, y: soundY + 10 },
    thickness: 1.5,
    color: LIGHT_GRAY,
  });

  // Line 4: Phonetic answer
  const answerY = contentTop - spacing * 3.5;
  const answerText = `\u201C${phoneticSymbol} like in ${word}\u201D`;
  // Auto-size: shrink if text is too wide
  let answerSize = 18;
  while (font.widthOfTextAtSize(answerText, answerSize) > rectW - 28 && answerSize > 10) {
    answerSize -= 1;
  }
  drawCentered(page, answerText, font, answerSize, answerY, DARK);

  return page;
}

/**
 * Generate a PDF for an order and upload it to Supabase Storage.
 */
export async function generateOrderPDF(order, entries) {
  if(order.survey_id)return enqueuePrivatePDF(order);
  return withPrivatePdfLease(supabase, order, async () => {
    const pdfBuffer=await renderInProcess(order,entries);
    return storeOrderPDF(order,pdfBuffer);
  });
}

export async function renderOrderPdfBytes(order, entries) {
  if (order.survey_id && !Number.isInteger(order.survey_revision)) throw new Error("Waiting for the customer's revised cards");
  console.log(`[PDF] Generating cards for order ${order.order_number}...`);

  // Create PDF document
  const pdfDoc = await PDFDocument.create();

  // Register fontkit and embed Nunito font
  pdfDoc.registerFontkit(fontkit);
  let font;
  const fontBytes = getNunitoFontBytes();
  if (fontBytes) {
    font = await pdfDoc.embedFont(fontBytes, { subset: true });
  } else {
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  }

  // Pre-fetch all photos. A customer-uploaded photo wins; otherwise, for a
  // letter the customer left on "Use Default", fall back to the stock default
  // image in public/defaults/ so default cards print a real picture.
  const enrichedEntries = [];
  for (const entry of entries) {
      let imageData = null;
      if (order.survey_id && entry.photo_storage_path?.startsWith(`surveys/${order.survey_id}/`)) {
        const { data, error } = await supabase.storage.from(PHOTO_BUCKET).download(entry.photo_storage_path);
        if (error || !data) throw new Error("Could not load a private survey photo");
        imageData = { bytes: new Uint8Array(await data.arrayBuffer()), contentType: data.type || "image/jpeg" };
      } else if (!order.survey_id) {
        imageData = await fetchImageBytes(entry.photo_url);
      }
      if (!imageData && entry.is_default) {
        imageData = loadDefaultImageBytes(entry.letter);
      }
      enrichedEntries.push({ ...entry, _imageData: imageData ? await preparePrintPhoto(imageData) : null });
  }

  let pdfBytes;
  if (bluePilotRequested(order)) {
    if (order.card_color !== "blue" || order.letter_style !== "lower") throw Error("This designer-template test requires the blue lowercase choice");
    if(!order.child_photo_storage_path?.startsWith(`surveys/${order.survey_id}/TITLE/`))throw Error("Please upload the child's photo and submit the revised survey before generating the title card");
    const {data:childImage,error:childError}=await supabase.storage.from(PHOTO_BUCKET).download(order.child_photo_storage_path);
    if(childError || !childImage)throw Error("Could not load the child's private title photo");
    pdfBytes = await renderBlueDesignerDeck({templateBytes:await loadBlueTemplate(),entries:enrichedEntries,fontBytes:getNunitoFontBytes(),titleCard:{name:order.child_name,photoData:await preparePrintPhoto({bytes:new Uint8Array(await childImage.arrayBuffer()),contentType:childImage.type||"image/jpeg"}),position:order.child_photo_position||{x:50,y:50}}});
  } else {
    for (const entry of enrichedEntries) {
      await drawFrontPage(pdfDoc, font, entry, order.letter_style);
      drawBackPage(pdfDoc, font, entry, order.letter_style);
    }
    pdfBytes = await pdfDoc.save();
  }
  const pdfBuffer = Buffer.from(pdfBytes);

  console.log(`[PDF] Rendered ${pdfBuffer.length} bytes for order ${order.order_number}`);

  return pdfBuffer;
}

async function storeOrderPDF(order,pdfBuffer) {
  // Rendering runs in a separate process that has exited before this upload.
  if (supabase) {
    try {
      const fileName = `order-${order.order_number}.pdf`;
      const storagePath = order.survey_id ? `surveys/${order.survey_id}/cards-${order.survey_revision}.pdf` : `orders/${fileName}`;
      const bucket = order.survey_id ? PDF_BUCKET : "order-pdfs";

      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(storagePath, pdfBuffer, {
          contentType: "application/pdf",
          upsert: true,
        });

      if (uploadError) {
        console.error("[PDF] Upload error:", uploadError);
        return null;
      }

      // Get public URL
      const publicUrl = order.survey_id ? `private:${bucket}/${storagePath}`
        : supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl;

      // Store URL on the order record
      let update = supabase
        .from("orders")
        .update({ pdf_url: publicUrl, updated_at: new Date().toISOString() })
        .eq("id", order.id);
      if (order.survey_id) update = update.eq("survey_revision", order.survey_revision);
      const { error: updateError } = await update;

      if (updateError) {
        console.error("[PDF] Failed to update order with pdf_url:", updateError);
      }

      console.log(`[PDF] Stored PDF for order ${order.order_number}`);
      return publicUrl;
    } catch (error) {
      console.error("[PDF] Upload/storage failed:", error);
      return null;
    }
  }

  console.warn("[PDF] No Supabase configured, PDF not stored");
  return null;
}

/** Private survey PDFs are read server-side; no public URL or signed link is stored. */
export async function readOrderPDF(order) {
  if (order.survey_id) {
    const { data: survey, error: surveyError } = await supabase.from("surveys").select("personalization_purging_at,personalization_deleted_at").eq("id",order.survey_id).single();
    if (surveyError || !survey) throw Error("These card files are not available");
    requirePersonalizationAvailable(survey);
    const path = privatePdfPath(order);
    const { data, error } = await supabase.storage.from(PDF_BUCKET).download(path);
    if (error || !data) throw new Error("Could not load PDF");
    return Buffer.from(await data.arrayBuffer());
  }
  const response = await fetch(order.pdf_url);
  if (!response.ok) throw new Error("Could not load PDF");
  return Buffer.from(await response.arrayBuffer());
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
