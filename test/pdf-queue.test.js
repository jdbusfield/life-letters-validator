import test from 'node:test';
import assert from 'node:assert/strict';
import {createPdfProcessor,enqueuePrivatePDF} from '../lib/pdfQueue.js';
import {privatePdfPath} from '../lib/privatePdfPath.js';

function fixture(count=1){
 const jobs=Array.from({length:count},(_,i)=>({id:`job-${i}`,order_id:`order-${i}`,survey_id:`set-${i}`,revision:i+1,claim_token:`token-${i}`,state:'queued',attempts:0}));
 const files=new Map(),published=[];
 const db={
  async rpc(name,args){
   if(name==='claim_life_letters_pdf'){
    const j=jobs.find(j=>j.state==='queued');if(!j)return{data:null};j.state='running';j.attempts++;return{data:{...j}};
   }
   if(name==='heartbeat_life_letters_pdf')return{data:true};
   const j=jobs.find(j=>j.id===args.p_job_id);
   if(name==='finish_life_letters_pdf_job'){
    if(j.claim_token!==args.p_token)return{data:false};
    if(args.p_error_code){j.state='retry';j.error_code=args.p_error_code;}else{j.state='ready';published.push(args.p_path);}
    return{data:true};
   }
  },
  from(table){let id;return{select(){return this;},eq(key,value){if(key==='id'||key==='order_id')id=value;return this;},
   async single(){const j=jobs.find(j=>j.order_id===id);return{data:{id,survey_id:j.survey_id,survey_revision:j.revision,child_name:`Name ${id}`}};},
   async order(){return{data:Array.from({length:26},(_,i)=>({order_id:id,letter:String.fromCharCode(65+i),word:`${id} word ${i}`}))};}
  };},
  storage:{from(){return{async upload(path,bytes){files.set(path,bytes);return{};}};}}
 };
 return{db,jobs,files,published};
}

test('simultaneous poll calls claim only one job per process and keep every set separate',async()=>{
 const f=fixture(10);let active=0,peak=0;
 const processor=createPdfProcessor({db:f.db,makeJobDb:()=>f.db,render:async(order,entries)=>{
   active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));
   assert.ok(entries.every(e=>e.order_id===order.id));active--;
   return Buffer.from(JSON.stringify({name:order.child_name,words:entries.map(e=>e.word)}));
 }});
 await Promise.all(Array.from({length:10},()=>processor.tick()));
 assert.equal(f.jobs.filter(j=>j.state==='ready').length,1);
 for(let i=1;i<10;i++)await processor.tick();
 assert.equal(peak,1);assert.equal(f.files.size,10);assert.equal(f.published.length,10);
 for(let i=0;i<10;i++){
  const content=JSON.parse(f.files.get(`surveys/set-${i}/cards-${i+1}/token-${i}.pdf`));
  assert.equal(content.name,`Name order-${i}`);assert.ok(content.words.every(w=>w.startsWith(`order-${i} `)));
 }
 processor.stop();
});

test('a render failure schedules retry and never uploads or publishes a fake ready PDF',async()=>{
 const f=fixture();const processor=createPdfProcessor({db:f.db,makeJobDb:()=>f.db,render:async()=>{throw Error('private image or service error');}});
 await processor.tick();assert.equal(f.jobs[0].state,'retry');assert.equal(f.jobs[0].error_code,'pdf_render_failed');assert.equal(f.files.size,0);assert.equal(f.published.length,0);processor.stop();
});

test('shutdown aborts active work before upload and records a retryable stopping result',async()=>{
 const f=fixture();let started;const ready=new Promise(resolve=>started=resolve);
 const processor=createPdfProcessor({db:f.db,makeJobDb:()=>f.db,render:async(_o,_e,{signal})=>{
   started();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 }});
 const work=processor.tick();await ready;processor.stop();await work;
 assert.equal(f.jobs[0].error_code,'pdf_worker_stopping');assert.equal(f.files.size,0);
});

test('an unavailable queue is reported instead of pretending the job was saved',async()=>{
 await assert.rejects(enqueuePrivatePDF({survey_id:'set',id:'order'},{db:{rpc:async()=>({error:{code:'connection_failed'}})}}),/Could not queue/);
});

test('private PDF reads accept only the current set and revision, including fenced attempts',()=>{
 const id='ca55c461-f3d5-43e6-8c47-e622b4625e9e',token='c0a80100-0000-4000-8000-000000000001';
 const order={survey_id:id,survey_revision:134};
 for(const tail of ['.pdf',`/${token}.pdf`]){
  const path=`surveys/${id}/cards-134${tail}`;assert.equal(privatePdfPath({...order,pdf_url:`private:survey-pdfs/${path}`}),path);
 }
 for(const bad of [`https://example.com/cards.pdf`,`private:survey-pdfs/surveys/${id}/cards-135.pdf`,`private:survey-pdfs/surveys/other/cards-134.pdf`,`private:survey-pdfs/surveys/${id}/cards-134/../bad.pdf`])assert.throws(()=>privatePdfPath({...order,pdf_url:bad}));
});
