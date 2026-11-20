// Offline layout QA. No production access, emails, or customer data.
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve} from "node:path";
import {renderBlueDesignerDeck,verifyBlueTemplate} from "../lib/designerBlueDeck.js";
import {DEFAULT_CARDS} from "../lib/letterData.js";
const [source,output="../output/pdf/blue-lowercase-workflow-test.pdf"]=process.argv.slice(2);
if(!source) throw Error("Pass the designer's original blue PDF path");
const entries=Object.entries(DEFAULT_CARDS).map(([letter,word])=>{
  let image;
  for(const [ext,type] of [["jpg","image/jpeg"],["png","image/png"]]){
    try{image={bytes:readFileSync(new URL(`../public/defaults/${letter}.${ext}`,import.meta.url)),contentType:type};break;}catch{}
  }
  return {letter,word,is_default:letter!=="A",_imageData:image};
});
const bytes=await renderBlueDesignerDeck({templateBytes:verifyBlueTemplate(readFileSync(source)),fontBytes:readFileSync(new URL("../lib/fonts/Nunito-Variable.ttf",import.meta.url)),entries});
const target=resolve(output);mkdirSync(resolve(target,".."),{recursive:true});writeFileSync(target,bytes);
console.log(JSON.stringify({pages:56,bytes:bytes.length,childNamePrinted:false,output:target}));
