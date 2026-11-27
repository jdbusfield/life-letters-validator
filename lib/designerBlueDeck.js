import { PDFDocument, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {DESIGNER_TEMPLATES,designerTemplate,verifyDesignerTemplate} from "./designerTemplates.js";
import {readFileSync} from "node:fs";
import {getTitleFontBytes,validateTitleName,circlePhotoPlacement,pushTitleCircleClip,popTitleCircleClip,drawCurvedTitleName} from "./titleCard.js";

// Compatibility exports preserve existing blue proofs and preview geometry tests.
export const BLUE_TEMPLATE = DESIGNER_TEMPLATES.blue;
export const BLUE_PHOTO_WINDOW = Object.freeze({ x: 166 * .24, y: (1725 - 1568) * .24, width: (1185 - 166) * .24, height: (1568 - 900) * .24 });
// Largest safe rectangle measured inside the source alpha mask, inset one source pixel.
export const BLUE_PHOTO_FIT = Object.freeze({ x:204*.24,y:(1725-1516)*.24,width:(1146-204)*.24,height:(1516-901)*.24 });
const LETTERS = Array.from({length:26},(_,i)=>String.fromCharCode(65+i));

export function bluePilotRequested(order, env = process.env) {
  // Approved final blue artwork applies to every saved blue lowercase set.
  if(order.survey_id && order.card_color==="blue" && order.letter_style==="lower")return true;
  const ids=(env.DESIGNER_BLUE_TEST_SURVEY_IDS || "").split(",").map(s=>s.trim()).filter(Boolean);
  return !!order.survey_id && ids.includes(order.survey_id);
}

export function verifyBlueTemplate(bytes) { return verifyDesignerTemplate(bytes,"blue"); }

export function photoFitPlacement(width,height,box=BLUE_PHOTO_FIT) {
  if (!(width>0 && height>0)) throw Error("Invalid photo dimensions");
  const scale=Math.min(box.width/width,box.height/height);
  return {x:box.x+(box.width-width*scale)/2,y:box.y+(box.height-height*scale)/2,width:width*scale,height:height*scale};
}

function centeredText(page,text,font,{y,size=25,maxWidth=208,minSize=8}) {
  while(font.widthOfTextAtSize(text,size)>maxWidth && size>minSize) size-=.25;
  if(font.widthOfTextAtSize(text,size)>maxWidth) throw Error("A word is too long for the card; review it before printing");
  page.drawText(text,{font,size,x:(BLUE_TEMPLATE.width-font.widthOfTextAtSize(text,size))/2,y,color:rgb(0,0,0)});
}

/** Preserve original artwork and populate the page-three title card and letter cards. */
export async function renderDesignerDeck({color,templateBytes,entries,fontBytes,titleCard}) {
  const template=designerTemplate(color);
  if(!fontBytes) throw Error("The card text font is unavailable");
  if(!titleCard?.photoData)throw Error("The child's title-card photo is required");
  validateTitleName(titleCard.name);
  if(entries.length!==26 || new Set(entries.map(e=>e.letter)).size!==26 || entries.some(e=>!LETTERS.includes(e.letter))) throw Error("The deck needs exactly one entry for each letter");
  const source=await PDFDocument.load(templateBytes);
  if(source.getPageCount()!==template.pages || source.getPages().some(p=>p.getWidth()!==324 || p.getHeight()!==414)) throw Error("The designer template's page size or page order needs review");
  const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
  // Match the raster artwork's Poppins Regular 25 pt sound prompt.
  const font=await doc.embedFont(readFileSync(new URL("./fonts/Poppins-Regular.ttf",import.meta.url)),{subset:true});
  const nameFont=await doc.embedFont(getTitleFontBytes(),{subset:true});
  const art=await doc.embedPages(source.getPages());
  const panel=template.answerPanel.slice(1);
  const answerBox=rgb(...[0,2,4].map(i=>parseInt(panel.slice(i,i+2),16)/255));
  for(let index=0;index<56;index++) {
    const page=doc.addPage([324,414]);
    page.setTrimBox(9,9,306,396);page.setBleedBox(0,0,324,414);
    page.drawRectangle({x:0,y:0,width:324,height:414,color:rgb(1,1,1)});
    const isFront=index>=4 && index%2===0;
    const letter=LETTERS[Math.floor((index-4)/2)];
    const entry=index>=4 ? entries.find(e=>e.letter===letter) : null;
    if(index===2){
      const data=titleCard.photoData;
      const image=data.contentType.includes("png")?await doc.embedPng(data.bytes):await doc.embedJpg(data.bytes);
      pushTitleCircleClip(page);page.drawImage(image,circlePhotoPlacement(image.width,image.height,titleCard.position));popTitleCircleClip(page);
    }
    if(isFront) {
      if(!entry._imageData) throw Error(`A photo is missing for ${letter}; the deck has not been generated`);
      const data=entry._imageData;
      const image=data.contentType.includes("png")?await doc.embedPng(data.bytes):await doc.embedJpg(data.bytes);
      const b=BLUE_PHOTO_WINDOW;
      page.pushOperators(pushGraphicsState(),rectangle(b.x,b.y,b.width,b.height),clip(),endPath());
      page.drawImage(image,photoFitPlacement(image.width,image.height));
      page.pushOperators(popGraphicsState());
    }
    page.drawPage(art[index],{x:0,y:0,width:324,height:414});
    if(index===2)drawCurvedTitleName(page,nameFont,titleCard.name);
    if(entry && !isFront) {
      if(["Q","X"].includes(letter)) {
        // Cover only the raster sound line, leaving the designer's surrounding panel intact.
        page.drawRectangle({x:51,y:108,width:222,height:37,color:answerBox});
        centeredText(page,letter==="Q"?"/kw/ like in":"/ks/ like in",font,{y:117,size:25,maxWidth:214,minSize:25});
      }
      centeredText(page,entry.word,font,{y:82,size:25,maxWidth:208,minSize:8});
    }
  }
  doc.setTitle(`Life Letters - ${color[0].toUpperCase()+color.slice(1)} Lowercase Cards`);
  doc.setSubject("56 pages: two introductory cards and 26 lowercase letter cards, front/back. Personalized curved first name and child photo on page three.");
  return doc.save();
}

export function renderBlueDesignerDeck(options) { return renderDesignerDeck({...options,color:"blue"}); }
