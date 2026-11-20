import {writeFile} from "node:fs/promises";
import {renderOrderPdfBytes} from "./pdfGenerator.js";
process.once("message",async({order,entries,output})=>{
 try{await writeFile(output,await renderOrderPdfBytes(order,entries),{mode:0o600});process.send({ready:true},()=>process.exit(0));}
 catch{console.error("[PDF] Isolated rendering failed");process.exit(1);}
});
