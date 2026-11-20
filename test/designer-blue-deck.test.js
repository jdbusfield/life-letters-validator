import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {PDFDocument} from "pdf-lib";
import {BLUE_TEMPLATE,bluePilotRequested,verifyBlueTemplate,photoFitPlacement,renderBlueDesignerDeck} from "../lib/designerBlueDeck.js";

test("the designer renderer is limited to explicitly selected private test surveys",()=>{
  const env={DESIGNER_BLUE_TEST_SURVEY_IDS:"test-one,test-two"};
  assert.equal(bluePilotRequested({survey_id:"test-one"},env),true);
  assert.equal(bluePilotRequested({survey_id:"real-customer"},env),false);
  assert.equal(bluePilotRequested({survey_id:"test-one"},{}),false);
  assert.equal(bluePilotRequested({},env),false);
  assert.throws(()=>verifyBlueTemplate(Buffer.from("replaced template")),/has changed/);
});

test("portrait and landscape photos stay completely inside the window without cropping or distortion",()=>{
  const box={x:40,y:38,width:244,height:160};
  for(const [width,height] of [[600,400],[400,900],[800,800]]){
    const p=photoFitPlacement(width,height,box);
    assert.ok(p.width<=box.width && p.height<=box.height);
    assert.ok(Math.abs(p.width/p.height-width/height)<1e-12);
    assert.equal(p.x+p.width/2,box.x+box.width/2);
    assert.equal(p.y+p.height/2,box.y+box.height/2);
  }
});

test("a complete deck preserves page pairs and print boxes, adds words, corrected sounds and its required title card",async()=>{
  const src=await PDFDocument.create();for(let i=0;i<56;i++)src.addPage([324,414]).drawText(`ART ${i+1}`,{x:10,y:390,size:8});
  const photo=await readFile(new URL("../public/defaults/A.jpg",import.meta.url));
  const entries=Array.from({length:26},(_,i)=>({letter:String.fromCharCode(65+i),word:i===16?"queen":i===23?"fox":"apple",_imageData:{contentType:"image/jpeg",bytes:photo}}));
  const fontBytes=await readFile(new URL("../lib/fonts/Nunito-Variable.ttf",import.meta.url));
  const titleCard={name:"Mia",photoData:{bytes:photo,contentType:"image/jpeg"},position:{x:50,y:50}};
  const bytes=await renderBlueDesignerDeck({templateBytes:await src.save(),entries:[...entries].reverse(),fontBytes,titleCard});
  const result=await PDFDocument.load(bytes);
  assert.equal(result.getPageCount(),56);
  for(const p of result.getPages()){
    assert.deepEqual(p.getMediaBox(),{x:0,y:0,width:324,height:414});
    assert.deepEqual(p.getTrimBox(),{x:9,y:9,width:306,height:396});
    assert.deepEqual(p.getBleedBox(),{x:0,y:0,width:324,height:414});
  }
  assert.equal(BLUE_TEMPLATE.trimWidth/72,4.25);
  await assert.rejects(renderBlueDesignerDeck({templateBytes:await src.save(),entries:entries.slice(1),fontBytes,titleCard}),/exactly one/);
  await assert.rejects(renderBlueDesignerDeck({templateBytes:await src.save(),entries:entries.map(e=>({...e,_imageData:null})),fontBytes,titleCard}),/photo is missing/);
  await assert.rejects(renderBlueDesignerDeck({templateBytes:await src.save(),entries,fontBytes}),/title-card photo is required/);
});
