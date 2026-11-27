import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {measurePreviewText,previewWordLayout,previewNameLayout,previewTitlePhoto,previewAtlasTile,allowedPreviewPhoto} from '../public/card-preview.js';
import {curvedNameLayout,circlePhotoPlacement} from '../lib/titleCard.js';
const metrics=JSON.parse(await readFile(new URL('../public/assets/card-preview/font-metrics.json',import.meta.url)));
test('preview text sizes and curved name positions match the print renderer',async()=>{
 const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
 const regular=await doc.embedFont(await readFile(new URL('../lib/fonts/Poppins-Regular.ttf',import.meta.url)));
 const bold=await doc.embedFont(await readFile(new URL('../lib/fonts/Poppins-Bold.ttf',import.meta.url)));
 for(const word of ['apple','Corey','office','butterfly','Wellington','Éloïse-Jane','A very long family name']){
  assert.ok(Math.abs(measurePreviewText(word,metrics.regular)-regular.widthOfTextAtSize(word,1))<1e-8,word);
  const layout=previewWordLayout(word,metrics.regular);assert.ok(layout.fits);assert.ok(regular.widthOfTextAtSize(word,layout.size)<=208);
 }
 for(const name of ['Izzy','Corey','Alexandria','Éloïse-Jane','W'.repeat(80)]){
  const printed=curvedNameLayout(bold,name),preview=previewNameLayout(name,metrics.bold);
  assert.equal(preview.length,printed.glyphs.length);
  preview.forEach((glyph,i)=>{const p=printed.glyphs[i];assert.ok(Math.abs(glyph.size-p.size)<1e-8);assert.ok(Math.abs(glyph.x-p.x)<1e-8);assert.ok(Math.abs(glyph.y-(414-p.y))<1e-8);assert.ok(Math.abs(glyph.rotation+p.rotation)<1e-8);});
 }
});
test('title-photo framing matches print coordinates for portrait and landscape images',()=>{
 for(const [width,height]of[[286,278],[300,900],[1200,700]])for(const position of [{x:0,y:0},{x:50,y:50},{x:100,y:100}]){
  const print=circlePhotoPlacement(width,height,position),preview=previewTitlePhoto(width,height,position);
  for(const key of ['x','width','height'])assert.ok(Math.abs(preview[key]-print[key])<1e-8);
  assert.ok(Math.abs(preview.y-(414-print.y-print.height))<1e-8);
 }
});
test('art atlases include a title and all 26 letter pairs in each actual designer color',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../public/assets/card-preview/manifest.json',import.meta.url)));
 assert.deepEqual(Object.keys(manifest.colors),['blue','pink','green','orange','yellow']);
 for(const color of Object.values(manifest.colors))for(const side of ['front','back']){
  const file=await readFile(new URL('../public'+color[side].split('?')[0],import.meta.url));assert.equal(file.toString('ascii',8,12),'WEBP');
 }
 assert.deepEqual(previewAtlasTile(0),{x:0,y:0});assert.deepEqual(previewAtlasTile(26),{x:648,y:2484});
});
test('preview uses only this application’s photos and local upload previews',()=>{
 const origin='https://life-letters-survey.onrender.com';
 assert.equal(allowedPreviewPhoto('/api/surveys/id/photos/id',origin),origin+'/api/surveys/id/photos/id');
 assert.equal(allowedPreviewPhoto('https://unrelated.example/photo.jpg',origin),'');
 assert.equal(allowedPreviewPhoto('javascript:alert(1)',origin),'');
 assert.match(allowedPreviewPhoto('blob:https://life-letters-survey.onrender.com/123',origin),/^blob:/);
});
