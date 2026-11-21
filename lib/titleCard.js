import {readFileSync} from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import {degrees,rgb,pushGraphicsState,popGraphicsState,moveTo,lineTo,appendBezierCurve,closePath,clip,endPath} from "pdf-lib";

export const TITLE_CIRCLE=Object.freeze({x:162,y:207,radius:98.7});
// Keep the enlarged name close to the photo, 3 mm above the original arc.
export const NAME_ARC=Object.freeze({x:162,y:207+21.6/2.54,radius:117,maxRadians:112*Math.PI/180,maxSize:48});
let fontBytes,checkedFont;
export function getTitleFontBytes(){return fontBytes ||= readFileSync(new URL("./fonts/Poppins-Bold.ttf",import.meta.url));}
export function validateTitleName(name){
  if(typeof name!=="string" || !name.trim() || name.length>80 || /[\u0000-\u001f\u007f]/u.test(name))throw Object.assign(Error("Enter the child's first name, up to 80 characters on one line"),{status:422});
  checkedFont ||= fontkit.create(getTitleFontBytes());
  if([...name.normalize("NFC")].some(c=>!checkedFont.hasGlyphForCodePoint(c.codePointAt(0))))throw Object.assign(Error("The title-card font cannot display a character in this name. Please contact contact@life-letters.com so we can help."),{status:422});
}
export function curvedNameLayout(font,name){
  const chars=[...new Intl.Segmenter(undefined,{granularity:"grapheme"}).segment(name.normalize("NFC"))].map(s=>s.segment);
  const tracking=.018;
  const widths=chars.map(c=>font.widthOfTextAtSize(c,1));
  const width=widths.reduce((a,b)=>a+b,0)+Math.max(chars.length-1,0)*tracking;
  if(!width)throw Error("The title-card name is empty");
  const size=Math.min(NAME_ARC.maxSize,NAME_ARC.radius*NAME_ARC.maxRadians/width);
  let offset=-width*size/2;
  const glyphs=chars.map((text,i)=>{
    const advance=widths[i]*size,angle=(offset+advance/2)/NAME_ARC.radius;
    const result={text,size,angle,x:NAME_ARC.x+NAME_ARC.radius*Math.sin(angle)-advance/2*Math.cos(angle),y:NAME_ARC.y+NAME_ARC.radius*Math.cos(angle)+advance/2*Math.sin(angle),rotation:-angle*180/Math.PI};
    offset+=advance+tracking*size;return result;
  });
  return {size,span:width*size/NAME_ARC.radius,glyphs};
}
export function circlePhotoPlacement(width,height,position={x:50,y:50}){
  const r=TITLE_CIRCLE.radius,d=2*r,scale=Math.max(d/width,d/height),w=width*scale,h=height*scale;
  return {x:TITLE_CIRCLE.x-r+(d-w)*position.x/100,y:TITLE_CIRCLE.y-r+(d-h)*(1-position.y/100),width:w,height:h};
}
export function pushTitleCircleClip(page){
  const {x,y,radius:r}=TITLE_CIRCLE,k=.5522847498307936*r;
  page.pushOperators(pushGraphicsState(),moveTo(x+r,y),appendBezierCurve(x+r,y+k,x+k,y+r,x,y+r),appendBezierCurve(x-k,y+r,x-r,y+k,x-r,y),appendBezierCurve(x-r,y-k,x-k,y-r,x,y-r),appendBezierCurve(x+k,y-r,x+r,y-k,x+r,y),closePath(),clip(),endPath());
}
export function popTitleCircleClip(page){page.pushOperators(popGraphicsState());}
export function drawCurvedTitleName(page,font,name){
  const layout=curvedNameLayout(font,name);
  for(const glyph of layout.glyphs)page.drawText(glyph.text,{font,size:glyph.size,x:glyph.x,y:glyph.y,rotate:degrees(glyph.rotation),color:rgb(1,1,1)});
  return layout;
}
