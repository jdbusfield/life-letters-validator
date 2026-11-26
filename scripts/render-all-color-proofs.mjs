// Offline print QA using bundled stock photos only. No customer data, orders or emails.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {PDFDocument} from 'pdf-lib';
import {renderDesignerDeck} from '../lib/designerBlueDeck.js';
import {DESIGNER_TEMPLATES,verifyDesignerTemplate} from '../lib/designerTemplates.js';
import {DEFAULT_CARDS} from '../lib/letterData.js';
const out=new URL('../output/all-color-print/',import.meta.url);await mkdir(out,{recursive:true});
const fontBytes=await readFile(new URL('../lib/fonts/Poppins-Regular.ttf',import.meta.url));
const entries=[];
for(const [letter,defaultWord]of Object.entries(DEFAULT_CARDS)){
 let photoData;for(const [ext,contentType]of[['jpg','image/jpeg'],['png','image/png']]){try{photoData={bytes:await readFile(new URL(`../public/defaults/${letter}.${ext}`,import.meta.url)),contentType};break;}catch{}}
 entries.push({letter,word:letter==='B'?'butterfly':defaultWord,is_default:letter!=='B',_imageData:photoData});
}
const report=[];
for(const color of Object.keys(DESIGNER_TEMPLATES)){
 const templateBytes=verifyDesignerTemplate(await readFile(new URL(`../../branding-source/final-card-art/${color}-lowercase-v8-final.pdf`,import.meta.url)),color);
 const name=color==='pink'?'Alexandria-Josephine':'Izzy';
 const pdf=await renderDesignerDeck({color,templateBytes,fontBytes,entries,titleCard:{name,photoData:entries.find(e=>e.letter==='J')._imageData,position:{x:50,y:50}}});
 await writeFile(new URL(`${color}-full-deck.pdf`,out),pdf);
 const full=await PDFDocument.load(pdf);if(full.getPageCount()!==56)throw Error('Wrong page count');
 const proof=await PDFDocument.create();for(const page of await proof.copyPages(full,[2,4,5,7,37,51]))proof.addPage(page);
 await writeFile(new URL(`${color}-proof.pdf`,out),await proof.save());
 report.push({color,name,pages:full.getPageCount(),bytes:pdf.length,sourceHashVerified:true});
 console.log(JSON.stringify(report.at(-1)));
}
await writeFile(new URL('report.json',out),JSON.stringify(report,null,2));
