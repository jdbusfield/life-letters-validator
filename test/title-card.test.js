import test from "node:test";
import assert from "node:assert/strict";
import {PDFDocument} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {getTitleFontBytes,validateTitleName,curvedNameLayout,circlePhotoPlacement,NAME_ARC,TITLE_CIRCLE} from "../lib/titleCard.js";
import {normalizeChildPhoto,safeDraft} from "../lib/surveyData.js";

test("Poppins Bold names fit the allowed arc for short, accented, long and maximum-length input",async()=>{
  const doc=await PDFDocument.create();doc.registerFontkit(fontkit);const font=await doc.embedFont(getTitleFontBytes(),{subset:true});
  const samples=["Mia","Éloïse","Alexandria-Josephine","W".repeat(80)];
  const layouts=samples.map(name=>{validateTitleName(name);const layout=curvedNameLayout(font,name);assert.ok(layout.span<=NAME_ARC.maxRadians+1e-10);assert.ok(layout.size>0&&layout.size<=NAME_ARC.maxSize);assert.equal(layout.glyphs.map(g=>g.text).join(""),name);assert.ok(layout.glyphs.every(g=>g.x>9&&g.x<315&&g.y>207&&g.y<405));return layout;});
  assert.ok(layouts[2].size<layouts[0].size);assert.ok(layouts[3].size<layouts[2].size);
  assert.throws(()=>validateTitleName("child\nname"),/one line/);assert.throws(()=>validateTitleName("A".repeat(81)));assert.throws(()=>validateTitleName("🙂"),/cannot display/);
});

test("circle framing covers the circle and matches CSS object-position for portrait/landscape extremes",()=>{
  const d=TITLE_CIRCLE.radius*2;
  for(const [w,h] of [[400,900],[900,400]])for(const position of [{x:0,y:0},{x:50,y:50},{x:100,y:100}]){
    const p=circlePhotoPlacement(w,h,position);assert.ok(p.width>=d&&p.height>=d);assert.ok(Math.abs(p.width/p.height-w/h)<1e-10);
    assert.ok(p.x<=TITLE_CIRCLE.x-TITLE_CIRCLE.radius+1e-9&&p.x+p.width>=TITLE_CIRCLE.x+TITLE_CIRCLE.radius-1e-9);
    assert.ok(p.y<=TITLE_CIRCLE.y-TITLE_CIRCLE.radius+1e-9&&p.y+p.height>=TITLE_CIRCLE.y+TITLE_CIRCLE.radius-1e-9);
  }
});

test("enlarged and auto-sized names keep descenders outside the dotted photo outline",async()=>{
  const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
  const font=await doc.embedFont(getTitleFontBytes(),{subset:true});
  const outlines=fontkit.create(getTitleFontBytes());
  for(const name of ['Corey','Mia','Lily','Gypsy','Alexandria-Josephine','Éloïse','W'.repeat(80)]){
    const layout=curvedNameLayout(font,name);
    if(name==='Corey')assert.equal(layout.size,48);
    if(name==='Alexandria-Josephine')assert.ok(layout.size<48);
    for(const g of layout.glyphs){
      const run=outlines.layout(g.text),scale=g.size/outlines.unitsPerEm;
      const angle=g.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
      // Transform the circle centre into glyph coordinates; the nearest point
      // in each ink bounding box gives a conservative clearance measurement.
      const dx=TITLE_CIRCLE.x-g.x,dy=TITLE_CIRCLE.y-g.y;
      const cx=c*dx+s*dy,cy=-s*dx+c*dy;
      let advance=0;
      for(let i=0;i<run.glyphs.length;i++){
        const box=run.glyphs[i].bbox,pos=run.positions[i];
        const left=(advance+pos.xOffset+box.minX)*scale,right=(advance+pos.xOffset+box.maxX)*scale;
        const bottom=(pos.yOffset+box.minY)*scale,top=(pos.yOffset+box.maxY)*scale;
        const distance=Math.hypot(cx-Math.max(left,Math.min(right,cx)),cy-Math.max(bottom,Math.min(top,cy)));
        assert.ok(distance>=109,`${name}: ${g.text} is too close to the dotted outline (${distance})`);
        advance+=pos.xAdvance;
      }
    }
  }
});

test("only the set's dedicated TITLE photo can populate its title card",()=>{
  const survey={id:"my-set",customer_email:"parent@example.com",order_reference:"TEST"};
  const photos=[{id:"title",survey_id:"my-set",letter:"TITLE",storage_path:"surveys/my-set/TITLE/photo.jpg"},{id:"letter",survey_id:"my-set",letter:"A",storage_path:"surveys/my-set/A/photo.jpg"},{id:"other",survey_id:"other-set",letter:"TITLE",storage_path:"surveys/other-set/TITLE/photo.jpg"}];
  assert.equal(safeDraft({letters:{}},survey,photos).childPhoto,null);
  assert.throws(()=>normalizeChildPhoto(null,survey,photos,true),/upload/);
  for(const index of [1,2])assert.throws(()=>normalizeChildPhoto({storagePath:photos[index].storage_path},survey,photos),/does not belong/);
  const value=normalizeChildPhoto({storagePath:photos[0].storage_path,photoUrl:"https://attacker.example/photo.jpg",position:{x:15,y:80}},survey,photos,true);
  assert.equal(value.photoUrl,"/api/surveys/my-set/photos/title");assert.deepEqual(value.position,{x:15,y:80});
  assert.throws(()=>normalizeChildPhoto({storagePath:photos[0].storage_path,position:{x:101,y:50}},survey,photos));
});
