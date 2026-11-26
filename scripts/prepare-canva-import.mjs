// Preserve the archived bleed PDF; create a finished-size copy for Canva import.
import{readFileSync,writeFileSync}from"node:fs";
import{PDFDocument}from"pdf-lib";
const[source,output]=process.argv.slice(2);
if(!source||!output)throw Error("Pass source bleed PDF and destination Canva PDF");
const src=await PDFDocument.load(readFileSync(source));
if(src.getPageCount()!==56||src.getPages().some(p=>p.getWidth()!==324||p.getHeight()!==414))throw Error("Expected the reviewed 56-page lowercase deck with bleed");
const doc=await PDFDocument.create(),pages=await doc.embedPages(src.getPages());
for(const art of pages){const page=doc.addPage([306,396]);page.drawPage(art,{x:-9,y:-9,width:324,height:414});page.setTrimBox(0,0,306,396);}
doc.setTitle(`${src.getTitle() || "Life Letters - Lowercase"} - Canva Import 4.25 x 5.5 in`);
doc.setSubject("Finished-size Canva import copy. Original survey PDF retains the designer's bleed.");
const bytes=await doc.save();writeFileSync(output,bytes);console.log(JSON.stringify({pages:56,widthInches:4.25,heightInches:5.5,bytes:bytes.length}));
