(()=>{
 let loading=false;
 async function load(){
  if(loading || document.getElementById('dashboard').style.display==='none')return;
  loading=true;
  const status=document.getElementById('pdfQueueStatus'),list=document.getElementById('pdfQueueJobs');
  try{
   const response=await fetch('/api/admin/pdf-jobs');if(!response.ok)throw Error('Could not check PDF preparation. Refresh or sign in again.');
   const {jobs}=await response.json();list.replaceChildren();
   const active=jobs.filter(j=>['queued','running','retry'].includes(j.state)).length,failed=jobs.filter(j=>j.state==='failed').length;
   status.textContent=`${active} waiting or preparing · ${failed} need attention. Status refreshes every 10 seconds.`;
   const labels={queued:'Queued',running:'Preparing PDF',retry:'Retry scheduled',ready:'Ready to download',failed:'Needs attention',superseded:'Reopened or replaced'};
   for(const job of jobs){
    const row=document.createElement('p');
    row.textContent=`${job.orders?.order_number||job.order_id} · ${labels[job.state]} · Attempts: ${job.attempts} `;
    if(job.state==='ready'){
      const link=document.createElement('a');link.className='btn btn-small';link.textContent='Download PDF';link.href=`/api/admin/orders/${encodeURIComponent(job.order_id)}/pdf`;link.download='';row.append(link);
    }
    if(job.state==='failed'){
      const button=document.createElement('button');button.className='btn btn-small';button.textContent='Retry PDF';button.onclick=async()=>{
       button.disabled=true;const r=await fetch(`/api/admin/pdf-jobs/${encodeURIComponent(job.id)}/retry`,{method:'POST'});
       if(!r.ok)alert((await r.json()).error||'Could not retry this PDF.');await load();
      };row.append(button);
    }
    list.append(row);
   }
  }catch(error){status.textContent=error.message;}finally{loading=false;}
 }
 document.addEventListener('DOMContentLoaded',()=>{
  window.loadPdfJobs=load;document.getElementById('refreshPdfJobs').addEventListener('click',load);load();setInterval(load,10000);
 });
})();
