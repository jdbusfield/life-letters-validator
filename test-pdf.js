/**
 * Quick test script to generate sample PDFs locally.
 * Run: node test-pdf.js [lower|upper|mix]
 * Output: test-output.pdf
 */
import puppeteer from "puppeteer";
import { LETTER_HINTS, DEFAULT_CARDS } from "./lib/letterData.js";
import { writeFileSync } from "fs";

function getPhoneticSymbol(letter) {
  const hint = LETTER_HINTS[letter.toUpperCase()] || "";
  const match = hint.match(/^(\/[^/]+\/)/);
  return match ? match[1] : `/${letter.toLowerCase()}/`;
}

// Letter style from CLI arg (default: "mix")
const letterStyle = process.argv[2] || "mix";

// Full 26-letter test data using default words
const testEntries = Object.entries(DEFAULT_CARDS).map(([letter, word]) => ({
  letter,
  word,
  photo_url: null,
}));

function buildHTML(entries, style) {
  const pages = [];

  for (const entry of entries) {
    const letter = entry.letter.toUpperCase();
    const lower = letter.toLowerCase();
    const word = entry.word;
    const phoneticSymbol = getPhoneticSymbol(letter);

    // Build front letter display based on style preference
    let letterDisplayHTML;
    if (style === "lower") {
      letterDisplayHTML = `<span class="letter-single">${lower}</span>`;
    } else if (style === "upper") {
      letterDisplayHTML = `<span class="letter-single">${letter}</span>`;
    } else {
      letterDisplayHTML = `
        <span class="letter-upper">${letter}</span>
        <span class="letter-lower">${lower}</span>`;
    }

    // Build back answer based on style preference
    const answerLetterDisplay = style === "upper" ? letter : lower;

    pages.push(`
      <div class="page front">
        <div class="letter-display">
          ${letterDisplayHTML}
        </div>
        <div class="photo-container photo-placeholder">
          <div class="placeholder-text">Photo goes here</div>
        </div>
      </div>
    `);

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

    * { margin: 0; padding: 0; box-sizing: border-box; }

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

    .photo-placeholder {
      background: #f0f0f0;
      border: 2px dashed #ccc;
    }

    .placeholder-text {
      color: #999;
      font-size: 16pt;
    }

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

async function main() {
  console.log(`Generating test PDF with letter style: "${letterStyle}"...`);
  const html = buildHTML(testEntries, letterStyle);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });

  const pdfBuffer = await page.pdf({
    width: "5in",
    height: "7in",
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });

  await browser.close();

  const outputFile = `test-output-${letterStyle}.pdf`;
  writeFileSync(outputFile, pdfBuffer);
  console.log(`Done! Generated ${outputFile} (${pdfBuffer.length} bytes, ${testEntries.length * 2} pages, style: ${letterStyle})`);
}

main().catch(console.error);
