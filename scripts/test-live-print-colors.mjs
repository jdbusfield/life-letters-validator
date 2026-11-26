// Internal-only live integration check. No Shopify purchases, customer photos or email delivery.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {makeSurveyRows,LETTERS} from '../lib/surveyData.js';
import {DEFAULT_CARDS} from '../lib/letterData.js';
const base='https://life-letters-survey.onrender.com',fixture='/private/tmp/ll-print-color-fixtures.json';
const colors=['pink','green','orange','yellow'];
if(process.argv[2]==='provision'){
 const items=colors.map(color=>({...makeSurveyRows({customerEmail:'print-color-qa@example.invalid',customerName:'INTERNAL COLOR PRINT QA',orderReference:`INTERNAL-PRINT-COLOR-${color}-${Date.now()}`,setCount:1,requestId:randomUUID()},base)[0],color}));
 await writeFile(fixture,JSON.stringify(items),{mode:0o600});
 const rows=JSON.stringify(items.map(i=>({...i.row,internal_test:true})));
 const sql=`insert into public.surveys(id,customer_email,customer_name,order_reference,set_label,unit_index,provisioning_key,access_token_hash,expires_at,draft,internal_test) select id,customer_email,customer_name,order_reference,set_label,unit_index,provisioning_key,access_token_hash,expires_at,draft,internal_test from jsonb_to_recordset($fixture$${rows}$fixture$::jsonb) as x(id uuid,customer_email text,customer_name text,order_reference text,set_label text,unit_index integer,provisioning_key text,access_token_hash text,expires_at timestamptz,draft jsonb,internal_test boolean); select id,order_reference,internal_test from public.surveys where id in (${items.map(i=>`'${i.row.id}'`).join(',')});`;
 await writeFile('/private/tmp/ll-print-color-provision.sql',sql,{mode:0o600});
 console.log(JSON.stringify({internalSurveys:items.length}));
}else{
 const items=JSON.parse(await readFile(fixture,'utf8'));
 const post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 async function call(item,path,options={}){
  const response=await fetch(`${base}/api/surveys/${item.row.id}${path}`,{...options,headers:{...(item.cookie?{cookie:item.cookie}:{}),...options.headers},signal:AbortSignal.timeout(90000)});
  const data=await response.json();if(!response.ok)throw Error(`${item.color} ${path}: ${response.status} ${data.error}`);
  if(response.headers.get('set-cookie'))item.cookie=response.headers.get('set-cookie').split(';')[0];return data;
 }
 if(process.argv[2]==='submit'){
  for(const item of items){
   const token=new URLSearchParams(item.link.split('#')[1]).get('token');await call(item,'/session',post({token}));
   const saved=await call(item,'');
   const draft={...saved.draft,childName:item.color==='pink'?'Alexandria-Josephine':'Print Test',cardColor:item.color,photoPermissionAccepted:true,photoPermissionVersion:'2026-11-18-v1',letters:Object.fromEntries(LETTERS.map(letter=>[letter,{word:DEFAULT_CARDS[letter],isDefault:true,status:'valid',feedback:''}]))};
   let result=await call(item,'',{...post({revision:saved.revision,draft}),method:'PUT'});
   for(const slot of ['TITLE','B','C']){
    const svg=`<svg width="${slot==='C'?400:900}" height="${slot==='C'?900:600}"><rect width="100%" height="100%" fill="${{pink:'#eb9da0',green:'#cedac3',orange:'#ffa55c',yellow:'#ffdf9d'}[item.color]}"/><text x="30" y="250" font-size="45">${item.color.toUpperCase()} ${slot}</text></svg>`;
    const bytes=await sharp(Buffer.from(svg)).jpeg().toBuffer(),form=new FormData();form.set('photo',new Blob([bytes],{type:'image/jpeg'}),`${item.color}-${slot}.jpg`);
    const photo=await call(item,`/photos/${slot}`,{method:'POST',body:form});
    const value={storagePath:photo.storagePath,photoUrl:photo.url};
    if(slot==='TITLE')draft.childPhoto={...value,position:{x:50,y:50}};
    else draft.letters[slot]={...value,word:slot==='B'?'butterfly':'cat',isDefault:false,status:'valid',feedback:''};
   }
   result=await call(item,'',{...post({revision:result.revision,draft}),method:'PUT'});
   await call(item,'/session',post({token}));const resumed=await call(item,'');
   if(resumed.draft.cardColor!==item.color||resumed.draft.letters.B.word!=='butterfly'||!resumed.draft.letters.C.storagePath)throw Error('Resume mismatch');
   item.result=await call(item,'/submit',post({revision:resumed.revision}));
   console.log(JSON.stringify({color:item.color,surveyId:item.row.id,...item.result}));
   await writeFile(fixture,JSON.stringify(items),{mode:0o600});
  }
  const ids=items.map(i=>`'${i.row.id}'`).join(',');
  await writeFile('/private/tmp/ll-print-color-status.sql',`select s.order_reference,s.internal_test,o.id as order_id,o.order_number,o.card_color,o.child_name,o.pdf_url,j.state,j.attempts,j.error_code from public.surveys s join public.orders o on o.survey_id=s.id left join public.pdf_jobs j on j.order_id=o.id where s.id in (${ids}) order by o.card_color;`,{mode:0o600});
 }
}
