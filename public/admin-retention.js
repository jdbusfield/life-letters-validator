(() => {
  const byId = id => document.getElementById(id);
  const date = value => value ? new Date(value).toLocaleString() : "—";
  async function request(path = "", body) {
    const response = await fetch(`/api/admin/photo-retention${path}`, body ? { method: "POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body) } : {});
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Could not check retention");
    return data;
  }
  function text(parent, value, tag = "p") { const el=document.createElement(tag);el.textContent=value;parent.append(el);return el; }
  function button(parent, label, action) { const b=document.createElement("button");b.className="btn btn-small";b.type="button";b.textContent=label;b.addEventListener("click",async()=>{b.disabled=true;try{await action();await load();}catch(e){byId("photoRetentionStatus").textContent=e.message;b.disabled=false;}});parent.append(b); }
  function check(parent,label) {const wrap=document.createElement("label");wrap.style.display="block";const input=document.createElement("input");input.type="checkbox";wrap.append(input,document.createTextNode(` ${label}`));parent.append(wrap);return input;}
  async function load() {
    try {
      const data=await request();
      byId("photoRetentionStatus").textContent=`Automatic survey cleanup ${data.enabled ? "enabled" : "paused"}. Last check: ${date(data.worker?.last_checked_at)}.${data.worker?.error_code ? " A cleanup check needs review." : ""} Older shipped sets missing a shipment date: ${data.historicalShipmentsNeedingDate || 0}. Inactive unfinished surveys to review, without automatic deletion: ${data.inactiveDraftsForReview || 0}.`;
      if(data.legacyFilesForReview || data.legacyOrdersForReview) byId("photoRetentionStatus").textContent+=` Earlier-system records need a separate date and file review: ${data.legacyOrdersForReview || 0} orders, ${data.legacyFilesForReview || 0} stored files. These have not been bulk-deleted.`;
      if(data.pdfLocksForReview) byId("photoRetentionStatus").textContent+=` ${data.pdfLocksForReview} interrupted PDF generation locks need review before cleanup.`;
      const container=byId("photoRetentionJobs");container.replaceChildren();
      const states={scheduled:"Scheduled",deleting:"Removing survey files",app_deleted:"Survey files removed — check working copies",complete:"Survey files removed; managed working copies confirmed"};
      for(const job of data.jobs || []) {
        const panel=document.createElement("div");panel.className="survey-link-panel";
        text(panel,job.order_reference,"strong");
        text(panel,`Shipped: ${date(job.shipped_at)} · Scheduled removal: ${date(job.delete_after)}`);
        text(panel,`${states[job.state] || job.state}${job.hold ? ` · On hold: ${job.hold_reason}` : ""}${job.error_code ? " · Retry or review needed" : ""}`);
        if(job.pdf_generation_started_at) text(panel,`PDF preparation lock: ${date(job.pdf_generation_started_at)}. If this persists after an interrupted deploy, ask for review before cleanup.`);
        if(job.state === "scheduled") button(panel,job.hold ? "Release retention hold" : "Pause for an order issue",async()=>{
          if(!confirm(job.hold ? "Release this hold? If its 90-day date has passed, automatic deletion can begin." : "Pause automatic deletion while this order issue is resolved? Release the hold when it is no longer needed.")) return;
          await request(`/${job.survey_id}/hold`,{hold:!job.hold,reason:"Open order issue"});
        });
        if(job.state === "app_deleted") {
          text(panel,"Confirm copies were removed or were never created:");
          const canva=check(panel,"Canva uploads and designs checked and removed");
          const working=check(panel,"Downloaded PDFs and other company working copies checked and removed");
          const trash=check(panel,"Trash/recycle bins and other managed copies checked");
          button(panel,"Confirm managed copies cleared",async()=>{
            if(!canva.checked || !working.checked || !trash.checked) throw Error("Check all three working-copy steps before confirming.");
            await request(`/${job.survey_id}/external-cleanup`,{canva:true,workingCopies:true,trash:true});
          });
        }
        if(job.external_cleanup_at) text(panel,`Managed-copy check recorded: ${date(job.external_cleanup_at)}`);
        container.append(panel);
      }
      if(!(data.jobs || []).length) text(container,"No shipped sets have a cleanup schedule yet. No customer files will be deleted before a shipment-based due date.");
    } catch(error) { byId("photoRetentionStatus").textContent=error.message; }
  }
  window.loadPhotoRetention=load;
  document.addEventListener("DOMContentLoaded",()=>{byId("refreshPhotoRetention").addEventListener("click",load);});
})();
