import {createClient} from '@supabase/supabase-js';
import {Router} from 'express';
import supabase from './supabase.js';
import {renderInProcess} from './pdfProcess.js';

export async function enqueuePrivatePDF(order,{db=supabase,force=false}={}){
  if(!db || !order.survey_id)throw Error('Saved PDF queue is unavailable');
  const {data,error}=await db.rpc('queue_life_letters_pdf',{p_order_id:order.id,p_force:force});
  if(error || !data?.id)throw Error('Could not queue this PDF. Please refresh the admin dashboard.');
  return data;
}

function jobClient(signal){
  return createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{
    auth:{persistSession:false,autoRefreshToken:false},
    global:{fetch:(input,init={})=>fetch(input,{...init,signal:AbortSignal.any([signal,AbortSignal.timeout(60000),...(init.signal?[init.signal]:[])])})}
  });
}

export function createPdfProcessor({db=supabase,makeJobDb=jobClient,render=renderInProcess,deadlineMs=300000,heartbeatMs=20000}={}){
  let running=false,stopping=false,active;
  async function tick(){
    if(running || stopping || !db)return;
    running=true;
    try{
      const {data:job,error}=await db.rpc('claim_life_letters_pdf');
      if(error)throw Error('PDF queue claim failed');
      if(!job?.id)return;
      const controller=new AbortController();active=controller;
      const io=makeJobDb(controller.signal);
      const deadline=setTimeout(()=>controller.abort(Error('pdf_timeout')),deadlineMs);
      let finished=false;
      const heartbeat=setInterval(()=>{
        io.rpc('heartbeat_life_letters_pdf',{p_job_id:job.id,p_token:job.claim_token}).then(result=>{
          if(!finished && (result.error || result.data!==true))controller.abort(Error('pdf_lease_lost'));
        }).catch(()=>{if(!finished)controller.abort(Error('pdf_lease_lost'));});
      },heartbeatMs);
      try{
        const orderResult=await io.from('orders').select('*').eq('id',job.order_id).eq('survey_revision',job.revision).single();
        const entriesResult=await io.from('letter_entries').select('*').eq('order_id',job.order_id).order('letter');
        if(orderResult.error || !orderResult.data || entriesResult.error || entriesResult.data?.length!==26)throw Error('pdf_snapshot_missing');
        const bytes=await render(orderResult.data,entriesResult.data,{signal:controller.signal});
        controller.signal.throwIfAborted();
        const path=`surveys/${job.survey_id}/cards-${job.revision}/${job.claim_token}.pdf`;
        const upload=await io.storage.from('survey-pdfs').upload(path,bytes,{contentType:'application/pdf',upsert:false});
        if(upload.error)throw Error('pdf_upload_failed');
        controller.signal.throwIfAborted();
        const result=await db.rpc('finish_life_letters_pdf_job',{p_job_id:job.id,p_token:job.claim_token,p_path:path,p_error_code:null});
        if(result.error || result.data!==true)throw Error('pdf_publish_unconfirmed');
        console.log('[PDF queue] Ready',{jobId:job.id,attempt:job.attempts});
      }catch(error){
        const reason=controller.signal.aborted?controller.signal.reason?.message:error.message;
        const code=/^pdf_[a-z_]+$/.test(reason||'')?reason:'pdf_render_failed';
        // Failure recording uses the control client, independent of the aborted I/O.
        const result=await db.rpc('finish_life_letters_pdf_job',{p_job_id:job.id,p_token:job.claim_token,p_path:null,p_error_code:code});
        if(result.error || result.data!==true)console.error('[PDF queue] Job recovery pending',{jobId:job.id});
      }finally{
        finished=true;clearInterval(heartbeat);clearTimeout(deadline);active=null;
      }
    }finally{running=false;}
  }
  return {tick,stop(){stopping=true;active?.abort(Error('pdf_worker_stopping'));}};
}

export function startPdfWorker(){
  if(!supabase)return()=>{};
  const processor=createPdfProcessor();
  const tick=()=>processor.tick().catch(()=>console.error('[PDF queue] Queue check failed'));
  tick();const timer=setInterval(tick,5000);timer.unref();
  return()=>{clearInterval(timer);processor.stop();};
}

export function createPdfQueueAdminRouter({db=supabase}={}){
  const router=Router();
  router.use('/api/admin/pdf-jobs',(req,res,next)=>{
    res.set('Cache-Control','no-store');
    if(!req.session?.isAdmin)return res.status(401).json({error:'Unauthorized'});
    if(!db)return res.status(503).json({error:'PDF queue unavailable'});
    next();
  });
  router.get('/api/admin/pdf-jobs',async(_req,res)=>{
    const {data,error}=await db.from('pdf_jobs').select('id,order_id,revision,state,attempts,error_code,retry_after,updated_at,orders(order_number,survey_revision)').order('created_at',{ascending:false}).limit(50);
    if(error)return res.status(503).json({error:'Could not read PDF jobs'});
    res.json({jobs:data.map(j=>({...j,state:j.revision===j.orders?.survey_revision?j.state:'superseded'}))});
  });
  router.post('/api/admin/pdf-jobs/:id/retry',async(req,res)=>{
    try{
      const {data:job,error}=await db.from('pdf_jobs').select('order_id').eq('id',req.params.id).single();
      if(error || !job)return res.status(404).json({error:'PDF job not found'});
      const {data:order}=await db.from('orders').select('*').eq('id',job.order_id).single();
      const queued=await enqueuePrivatePDF(order,{db,force:true});
      res.status(202).json({queued:true,state:queued.state});
    }catch{res.status(409).json({error:'This set cannot be retried. Refresh its submitted survey status.'});}
  });
  return router;
}
