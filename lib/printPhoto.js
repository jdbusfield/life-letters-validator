import sharp from "sharp";
// Process one original at a time. Originals remain in private storage unchanged.
sharp.cache(false);
sharp.concurrency(1);
export async function preparePrintPhoto(image) {
  const bytes=await sharp(image.bytes).rotate().resize({width:1600,height:1600,fit:"inside",withoutEnlargement:true}).flatten({background:"#ffffff"}).toColourspace("srgb").jpeg({quality:92,chromaSubsampling:"4:4:4"}).toBuffer();
  return {bytes:new Uint8Array(bytes),contentType:"image/jpeg"};
}
