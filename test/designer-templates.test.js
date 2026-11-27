import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DESIGNER_TEMPLATES,designerTemplateForOrder,verifyDesignerTemplate} from '../lib/designerTemplates.js';
import {renderDesignerDeck} from '../lib/designerBlueDeck.js';
import {PDFDocument} from 'pdf-lib';

test('every saved lowercase color selects its own pinned artwork; missing or unsupported choices cannot fall back',async()=>{
 const preview=JSON.parse(await readFile(new URL('../public/assets/card-preview/manifest.json',import.meta.url)));
 for(const color of ['blue','pink','green','orange','yellow']){
  const template=designerTemplateForOrder({survey_id:'private-set',card_color:color,letter_style:'lower'});
  assert.equal(template,DESIGNER_TEMPLATES[color]);
  assert.equal(template.path,`templates/${color}-lowercase-v8-final.pdf`);
  assert.equal(template.sha256,preview.colors[color].sourceSha256);
  assert.equal(template.answerPanel,preview.colors[color].answerPanel);
  assert.throws(()=>verifyDesignerTemplate(Buffer.from('wrong color or changed PDF'),color),/has changed/);
 }
 assert.equal(designerTemplateForOrder({}),null);
 for(const card_color of ['',null,'purple','toString','__proto__'])assert.throws(()=>designerTemplateForOrder({survey_id:'private-set',card_color,letter_style:'lower'}),/supported card color/);
 assert.throws(()=>designerTemplateForOrder({survey_id:'private-set',card_color:'blue',letter_style:'upper'}),/lowercase/);
});

test('all five renderer paths preserve front/back pairs, correct print dimensions and selected color metadata',async()=>{
 const source=await PDFDocument.create();for(let i=0;i<56;i++)source.addPage([324,414]).drawText(`ART ${i+1}`,{x:10,y:390,size:8});
 const templateBytes=await source.save();
 const bytes=await readFile(new URL('../public/defaults/A.jpg',import.meta.url));
 const photoData={bytes,contentType:'image/jpeg'};
 const entries=[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(letter=>({letter,word:letter==='Q'?'queen':letter==='X'?'fox':'apple',_imageData:photoData}));
 for(const color of Object.keys(DESIGNER_TEMPLATES)){
  const result=await PDFDocument.load(await renderDesignerDeck({color,templateBytes,entries,fontBytes:bytes,titleCard:{name:color==='pink'?'Alexandria-Josephine':'Mia',photoData}}));
  assert.equal(result.getPageCount(),56);
  assert.match(result.getTitle(),new RegExp(color,'i'));
  for(const p of result.getPages()){
   assert.deepEqual(p.getMediaBox(),{x:0,y:0,width:324,height:414});
   assert.deepEqual(p.getTrimBox(),{x:9,y:9,width:306,height:396});
   assert.deepEqual(p.getBleedBox(),{x:0,y:0,width:324,height:414});
  }
 }
});
