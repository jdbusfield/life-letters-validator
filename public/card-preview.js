// Screen previews use the final designer artwork, with photos beneath its alpha windows.
const COLORS=['blue','pink','green','orange','yellow'];
const LETTERS=[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const segments=value=>[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(String(value).normalize('NFC'))].map(s=>s.segment);
export function measurePreviewText(text,metrics){return [...String(text).normalize('NFC')].reduce((sum,c)=>sum+(metrics[c]??metrics['?']??.6),0);}
export function previewWordLayout(word,metrics){
 const width=measurePreviewText(word,metrics);let size=25;
 while(width*size>208&&size>8)size-=.25;
 return {size,fits:width*size<=208};
}
export function previewNameLayout(name,metrics){
 const chars=segments(name),widths=chars.map(c=>measurePreviewText(c,metrics));
 const width=widths.reduce((a,b)=>a+b,0)+Math.max(chars.length-1,0)*.018;
 if(!width)return [];
 const radius=117,size=Math.min(48,radius*(112*Math.PI/180)/width);
 let offset=-width*size/2;
 return chars.map((text,i)=>{
  const advance=widths[i]*size,angle=(offset+advance/2)/radius;
  const glyph={text,size,x:162+radius*Math.sin(angle)-advance/2*Math.cos(angle),y:414-(207+21.6/2.54+radius*Math.cos(angle)+advance/2*Math.sin(angle)),rotation:angle*180/Math.PI};
  offset+=advance+.018*size;return glyph;
 });
}
export function previewTitlePhoto(width,height,position={x:50,y:50}){
 const diameter=197.4,scale=Math.max(diameter/width,diameter/height),w=width*scale,h=height*scale;
 return {x:63.3+(diameter-w)*(position.x??50)/100,y:108.3+(diameter-h)*(position.y??50)/100,width:w,height:h};
}
export function previewAtlasTile(index){return {x:(index%4)*324,y:Math.floor(index/4)*414};}
export function allowedPreviewPhoto(value,origin){
 if(!value)return '';
 try{const url=new URL(value,origin);return url.protocol==='blob:'||(['http:','https:'].includes(url.protocol)&&url.origin===origin)?url.href:'';}catch{return '';}
}
let assets;
async function getAssets(){
 return assets ||= Promise.all(['manifest.json','font-metrics.json'].map(async file=>{
  const response=await fetch(`/assets/card-preview/${file}?v=20261125`);if(!response.ok)throw Error('Card artwork could not load. Please try Preview Cards again.');return response.json();
 })).catch(error=>{assets=null;throw error;});
}
function atlas(url,index){const tile=previewAtlasTile(index);return `<svg x="0" y="0" width="324" height="414" viewBox="${tile.x} ${tile.y} 324 414" overflow="hidden"><image href="${esc(url)}" x="0" y="0" width="1296" height="2898" preserveAspectRatio="none"/></svg>`;}
function page(content,label){return `<svg class="designed-card-art" viewBox="9 9 306 396" role="img" aria-label="${esc(label)}"><rect width="324" height="414" fill="white"/>${content}</svg>`;}
function image(url,box,extra=''){return `<image href="${esc(url)}" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" preserveAspectRatio="xMidYMid meet" ${extra}/>`;}
function placeholder(box,label){return `<rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="#f2f4f3"/><text x="162" y="${box.y+box.height/2}" text-anchor="middle" font-family="LifeLettersCardRegular" font-size="12" fill="#536c74">${esc(label)}</text>`;}
function titleFront(art,child,dimensions,name,metrics){
 let photo=placeholder({x:63.3,y:108.3,width:197.4,height:197.4},'Add child’s photo');
 if(child?.photoUrl&&dimensions)photo=image(child.photoUrl,previewTitlePhoto(dimensions.width,dimensions.height,child.position));
 const glyphs=previewNameLayout(name,metrics).map(g=>`<text transform="translate(${g.x} ${g.y}) rotate(${g.rotation})" font-size="${g.size}" font-family="LifeLettersCardBold" fill="white">${esc(g.text)}</text>`).join('');
 return page(`<defs><clipPath id="preview-child-circle"><circle cx="162" cy="207" r="98.7"/></clipPath></defs><g clip-path="url(#preview-child-circle)">${photo}</g>${atlas(art.front,0)}${glyphs}`,'Title card with child’s name and photo');
}
function letterFront(art,index,entry){
 const box={x:48.96,y:216.24,width:226.08,height:147.6};
 const photo=entry.photoUrl?image(entry.photoUrl,box):placeholder(box,'Add a photo');
 return page(photo+atlas(art.front,index),`${entry.letter.toLowerCase()} card front: ${entry.word||'word not entered'}`);
}
function letterBack(art,index,entry,metrics){
 const layout=previewWordLayout(entry.word,metrics);
 let correction='';
 if(['Q','X'].includes(entry.letter))correction=`<rect x="51" y="269" width="222" height="37" fill="${art.answerPanel}"/><text x="162" y="297" text-anchor="middle" font-family="LifeLettersCardRegular" font-size="25" fill="black">${entry.letter==='Q'?'/kw/ like in':'/ks/ like in'}</text>`;
 const word=layout.fits?entry.word:'Please shorten this word';
 return page(`${atlas(art.back,index)}${correction}<text x="162" y="332" text-anchor="middle" font-family="LifeLettersCardRegular" font-size="${layout.fits?layout.size:10}" fill="black">${esc(word)}</text>`,`${entry.letter.toLowerCase()} card back: ${entry.word||'word not entered'}`);
}
async function dimensions(url){
 if(!url)return null;
 return new Promise(resolve=>{const img=new Image();img.onload=()=>resolve({width:img.naturalWidth,height:img.naturalHeight});img.onerror=()=>resolve(null);img.src=url;});
}
let renderId=0;
export async function renderDesignerPreview({color,childName='',childPhoto,entries}){
 const id=++renderId;
 const grid=document.getElementById('previewGrid'),note=document.getElementById('previewNote');
 grid.innerHTML='<p class="preview-loading" role="status">Loading your card designs…</p>';
 const selected=COLORS.includes(color)?color:'blue';
 const [manifest,metrics]=await getAssets();
 await Promise.all([document.fonts.load('25px LifeLettersCardRegular'),document.fonts.load('700 48px LifeLettersCardBold')]);
 const origin=location.origin;
 const child=childPhoto?{...childPhoto,photoUrl:allowedPreviewPhoto(childPhoto.photoUrl,origin)}:null;
 const size=await dimensions(child?.photoUrl);if(id!==renderId)return;
 const art=manifest.colors[selected];
 note.textContent=`${selected[0].toUpperCase()+selected.slice(1)} ${color?'cards':'example — choose your card color in the survey'}. These previews use your designer’s artwork. Finished cards are 4.25″ × 5.5″; screens and printed colors can differ slightly.`;
 const card=(label,front,back,description)=>`<article class="designed-preview-card"><h3>${esc(label)}</h3><div class="designed-preview-face preview-front">${front}</div><div class="designed-preview-face preview-back" hidden>${back}</div><p class="designed-preview-description">${esc(description)}</p></article>`;
 const title=card('Title card',titleFront(art,child,size,childName,metrics.bold),page(atlas(art.back,0),'Title card back: how to use Life Letters'),childName||'Add your child’s name in the survey');
 grid.innerHTML=title+LETTERS.map((letter,n)=>{
  const source=entries.find(e=>e.letter===letter)||{};
  const entry={...source,letter,word:source.word||'',photoUrl:allowedPreviewPhoto(source.photoUrl,origin)};
  const wordLayout=previewWordLayout(entry.word,metrics.regular);
  const status=!wordLayout.fits?'Please shorten this word':!entry.photoUrl?'Photo needed':entry.isDefault?'Default word and photo':entry.status==='invalid'||entry.status==='error'?'Word needs attention':entry.status==='pending'?'Word still needs checking':'';
  return card(letter==='Q'?'qu':letter.toLowerCase(),letterFront(art,n+1,entry),letterBack(art,n+1,entry,metrics.regular),[entry.word||'Add a word',status].filter(Boolean).join(' · '));
 }).join('');
 setPreviewSide('front');
}
function setPreviewSide(side){
 document.querySelectorAll('#previewGrid .preview-front').forEach(el=>{el.hidden=side!=='front';});
 document.querySelectorAll('#previewGrid .preview-back').forEach(el=>{el.hidden=side!=='back';});
 document.querySelectorAll('[data-preview-side]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.previewSide===side)));
 document.getElementById('previewGrid').scrollTop=0;
}
if(typeof window!=='undefined'){
 window.LifeLettersCardPreview={render:renderDesignerPreview,cancel(){renderId++;document.getElementById('previewGrid').replaceChildren();}};
 document.addEventListener('click',event=>{const button=event.target.closest('[data-preview-side]');if(button)setPreviewSide(button.dataset.previewSide);});
}
