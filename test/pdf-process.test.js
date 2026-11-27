import test from "node:test";
import assert from "node:assert/strict";
import {PDFDocument} from "pdf-lib";
import {renderInProcess} from "../lib/pdfProcess.js";
test("isolated rendering returns a complete PDF after the worker exits",async()=>{
 const bytes=await renderInProcess({order_number:"LOCAL-PDF-WORKER-NO-ORDER",letter_style:"lower"},[{letter:"A",word:"apple",is_default:true}]);
 const pdf=await PDFDocument.load(bytes);assert.equal(pdf.getPageCount(),2);assert.equal(pdf.getPage(0).getWidth(),306);
});
