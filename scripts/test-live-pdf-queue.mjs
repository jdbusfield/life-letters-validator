// Synthetic live integration test. No Shopify orders, email recipients, or real children.
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {makeSurveyRows,LETTERS} from '../lib/surveyData.js';
import {DEFAULT_CARDS} from '../lib/letterData.js';
const base='https://life-letters-survey.onrender.com';
const fixture='/private/tmp/life-letters-pdf-load-fixtures.json';
if(process.argv[2]==='provision'){
 const items=makeSurveyRows({customerEmail:'pdf-loadtest@example.invalid',customerName:'INTERNAL PDF Load Test',orderReference:`INTERNAL-PDF-LOADTEST-${Date.now()}`,setCount:10,requestId:randomUUID()},base);
 await writeFile(fixture,JSON.stringify(items),{mode:0o600});
 const rows=JSON.stringify(items.map(i=>({...i.row,internal_test:true})));
 const sql=`insert into public.surveys(id,customer_email,customer_name,order_reference,set_label,unit_index,provisioning_key,access_token_hash,expires_at,draft,internal_test) select id,customer_email,customer_name,order_reference,set_label,unit_index,provisioning_key,access_token_hash,expires_at,draft,internal_test from jsonb_to_recordset($fixture$${rows}$fixture$::jsonb) as x(id uuid,customer_email text,customer_name text,order_reference text,set_label text,unit_index integer,provisioning_key text,access_token_hash text,expires_at timestamptz,draft jsonb,internal_test boolean); select count(*) as internal_test_surveys from public.surveys where id in (${items.map(i=>`'${i.row.id}'`).join(',')});`;
 await writeFile('/private/tmp/life-letters-pdf-load-provision.sql',sql,{mode:0o600});
 console.log(JSON.stringify({createdFixtures:items.length}));
}else{
 const items=JSON.parse(await readFile(fixture,'utf8'));
 async function call(id,path,options={},cookie){
  const r=await fetch(`${base}/api/surveys/${id}${path}`,{...options,headers:{...(cookie?{cookie}:{}),...options.headers},signal:AbortSignal.timeout(90000)});
  const data=await r.json();if(!r.ok)throw Error(`${r.status} ${path}: ${data.error}`);return {data,cookie:r.headers.get('set-cookie')?.split(';')[0]};
 }
 const post=(body)=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 if(process.argv[2]==='prepare'){
  // Ten independent sessions, each uploading its own 27 numbered synthetic images.
  await Promise.all(items.map(async(item,index)=>{
   const id=item.row.id,token=new URLSearchParams(item.link.split('#')[1]).get('token');
   let {cookie}=await call(id,'/session',post({token}));
   let {data:saved}=await call(id,'',{},cookie);
   let draft={...saved.draft,childName:`Queue Test ${index+1}`,cardColor:'blue',photoPermissionAccepted:true,photoPermissionVersion:'2026-11-18-v1'};
   let result=await call(id,'',{...post({revision:saved.revision,draft}),method:'PUT'},cookie);
   for(const [slotNumber,slot] of ['TITLE',...LETTERS].entries()){
    const svg=`<svg width="900" height="900"><rect width="900" height="900" fill="hsl(${index*33},65%,75%)"/><text x="450" y="430" text-anchor="middle" font-size="100">SET ${index+1}</text><text x="450" y="570" text-anchor="middle" font-size="100">${slot}</text><circle cx="450" cy="680" r="${20+slotNumber*3}" fill="white"/></svg>`;
    const bytes=await sharp(Buffer.from(svg)).png().toBuffer();
    const form=new FormData();form.set('photo',new Blob([bytes],{type:'image/png'}),`set-${index+1}-${slot}.png`);
    const {data:photo}=await call(id,`/photos/${slot}`,{method:'POST',body:form},cookie);
    const value={storagePath:photo.storagePath,photoUrl:photo.url};
    if(slot==='TITLE')draft.childPhoto={...value,position:{x:50,y:50}};
    else draft.letters[slot]={...value,word:DEFAULT_CARDS[slot],isDefault:false,status:'valid',feedback:''};
   }
   result=await call(id,'',{...post({revision:result.data.revision,draft}),method:'PUT'},cookie);
   // A second-device session must see the same completed saved survey.
   ({cookie}=await call(id,'/session',post({token})));
   const {data:resumed}=await call(id,'',{},cookie);
   if(Object.keys(resumed.draft.letters).length!==26 || resumed.draft.childName!==draft.childName || resumed.draft.childPhoto.storagePath!==draft.childPhoto.storagePath)throw Error('Resume mismatch');
   item.cookie=cookie;item.revision=resumed.revision;
   console.log(JSON.stringify({prepared:index+1,photos:27,resumed:true}));
  }));
  await writeFile(fixture,JSON.stringify(items),{mode:0o600});
 }else if(process.argv[2]==='submit'){
  const started=Date.now();
  const results=await Promise.all(items.map(async(item,index)=>{
   const t=Date.now(); const {data}=await call(item.row.id,'/submit',post({revision:item.revision}),item.cookie);
   return {index:index+1,surveyId:item.row.id,...data,ms:Date.now()-t};
  }));
  const repeats=await Promise.all(items.map(item=>call(item.row.id,'/submit',post({revision:item.revision}),item.cookie)));
  if(repeats.some((r,i)=>!r.data.alreadySubmitted || r.data.orderId!==results[i].orderId))throw Error('Duplicate submission mismatch');
  const report={startedAt:new Date(started).toISOString(),completedAt:new Date().toISOString(),durationMs:Date.now()-started,results,duplicateSubmissionsIdempotent:true};
  await writeFile('/private/tmp/life-letters-pdf-load-results.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
 }
}
