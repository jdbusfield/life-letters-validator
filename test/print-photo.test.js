import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {preparePrintPhoto} from "../lib/printPhoto.js";
test("phone photos are oriented and sized for print without cropping or changing originals",async()=>{
 const original=await sharp({create:{width:4000,height:3000,channels:3,background:"red"}}).jpeg().withMetadata({orientation:6}).toBuffer();
 const copy=Buffer.from(original),result=await preparePrintPhoto({bytes:original,contentType:"image/jpeg"});
 const meta=await sharp(result.bytes).metadata();assert.equal(meta.width,1200);assert.equal(meta.height,1600);assert.equal(meta.format,"jpeg");assert.deepEqual(original,copy);assert.ok(result.bytes.length<original.length);
});
test("small transparent pictures keep dimensions and become white-backed print images",async()=>{
 const original=await sharp({create:{width:200,height:100,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
 const result=await preparePrintPhoto({bytes:original,contentType:"image/png"});const meta=await sharp(result.bytes).metadata();assert.equal(meta.width,200);assert.equal(meta.height,100);assert.equal(meta.hasAlpha,false);
});
