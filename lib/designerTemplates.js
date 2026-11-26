import {createHash} from "node:crypto";

const PRINT_LAYOUT = Object.freeze({pages:56,width:324,height:414,bleed:9,trimWidth:306,trimHeight:396});
export const DESIGNER_TEMPLATES = Object.freeze({
  blue: Object.freeze({...PRINT_LAYOUT, color: "blue", bucket: "survey-pdfs", path: "templates/blue-lowercase-v8-final.pdf", sha256: "b15b0e2499b87de00dac1855d102720db46204d3558bfe6aaa63c372f037a311", answerPanel: "#e1ebf7"}),
  pink: Object.freeze({...PRINT_LAYOUT, color: "pink", bucket: "survey-pdfs", path: "templates/pink-lowercase-v8-final.pdf", sha256: "5ae669bc1cde955ec06454cd1c9806c7320fa213898307355064ff35e559fa50", answerPanel: "#fbe6e1"}),
  green: Object.freeze({...PRINT_LAYOUT, color: "green", bucket: "survey-pdfs", path: "templates/green-lowercase-v8-final.pdf", sha256: "b122534a0cd62172154d632ec8fccc59cb96bbc2c43284d7e729cadd9da38de8", answerPanel: "#f0f7f0"}),
  orange: Object.freeze({...PRINT_LAYOUT, color: "orange", bucket: "survey-pdfs", path: "templates/orange-lowercase-v8-final.pdf", sha256: "9fa0300a3887c512f2d9758aedd592d65afa18083615122fd89a35cd8c65584e", answerPanel: "#fde7d0"}),
  yellow: Object.freeze({...PRINT_LAYOUT, color: "yellow", bucket: "survey-pdfs", path: "templates/yellow-lowercase-v8-final.pdf", sha256: "7a56050653cbf7a96ddf41711a9e82e2250defb92713e3741408e8f5bb68c173", answerPanel: "#fff2e2"}),
});

export function designerTemplate(color) {
  if(!Object.hasOwn(DESIGNER_TEMPLATES,color))throw Error("Choose a supported card color before printing");
  return DESIGNER_TEMPLATES[color];
}

/** Every private set must use approved art; never silently fall back to generic cards. */
export function designerTemplateForOrder(order) {
  if(!order.survey_id)return null;
  if(order.letter_style!=="lower")throw Error("The final card artwork requires lowercase letters");
  return designerTemplate(order.card_color);
}

export function verifyDesignerTemplate(bytes,color) {
  const template=designerTemplate(color);
  if(createHash("sha256").update(bytes).digest("hex")!==template.sha256)throw Error(`The approved ${color} template file has changed; review its layout before printing`);
  return bytes;
}
