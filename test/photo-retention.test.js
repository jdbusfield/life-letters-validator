import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { createRetentionProcessor,createRetentionAdminRouter,validatedManifest } from "../lib/photoRetention.js";
import { withPrivatePdfLease,requirePersonalizationAvailable,hasPhotoPermission,PHOTO_PERMISSION_VERSION } from "../lib/photoPrivacy.js";
const id="12345678-1234-4234-8234-123456789abc";

function fixture(manifest, fail=false) {
  const calls=[],removed=[];
  let claimed=false;
  const db={storage:{from:bucket=>({async remove(paths){removed.push({bucket,paths});return{error:fail?Error("private details"):null};}})},async rpc(name,args){calls.push({name,args});
    if(name==="claim_life_letters_retention") {if(claimed)return{data:[]};claimed=true;return{data:[{survey_id:id,claim_token:"claim",manifest}]};}
    return{data:true};
  }};
  return{db,calls,removed,process:createRetentionProcessor({db,enabled:()=>true})};
}
test("retention removes only the claimed set's private photos and all PDF revisions before finalizing",async()=>{
  const f=fixture([{bucket:"survey-photos",path:`surveys/${id}/A/old.jpg`},{bucket:"survey-pdfs",path:`surveys/${id}/cards-1.pdf`},{bucket:"survey-pdfs",path:`surveys/${id}/cards-9.pdf`}]);
  await f.process();
  assert.equal(f.removed.length,2);assert.equal(f.removed[1].paths.length,2);
  assert.deepEqual(f.calls.find(c=>c.name==="finish_life_letters_retention").args,{p_survey_id:id,p_claim_token:"claim",p_error:null});
});
test("a manifest with a different survey, public bucket, or traversal never deletes any file",async()=>{
  for(const file of [{bucket:"letter-photos",path:`surveys/${id}/A.jpg`},{bucket:"survey-photos",path:"surveys/another-set/A.jpg"},{bucket:"survey-photos",path:`surveys/${id}/../A.jpg`}]) {
    const f=fixture([file]);await f.process();assert.equal(f.removed.length,0);
    assert.equal(f.calls.find(c=>c.name==="finish_life_letters_retention").args.p_error,"invalid_retention_manifest");
  }
  assert.throws(()=>validatedManifest({survey_id:"invalid",manifest:[]}));
});
test("failed storage deletion records a retry and never reports successful erasure",async()=>{
  const f=fixture([{bucket:"survey-photos",path:`surveys/${id}/A.jpg`}],true);await f.process();
  assert.equal(f.calls.find(c=>c.name==="finish_life_letters_retention").args.p_error,"retention_storage_failed");
  assert.equal(JSON.stringify(f.calls).includes("private details"),false);
});
test("disabled or overlapping checks do not create duplicate deletion attempts",async()=>{
  let release,claims=0;
  const db={async rpc(name){if(name==="claim_life_letters_retention"){claims++;return new Promise(r=>{release=()=>r({data:[]});});}return{};}};
  const disabled=createRetentionProcessor({db,enabled:()=>false});await disabled();assert.equal(claims,0);
  const run=createRetentionProcessor({db,enabled:()=>true});const first=run();await run();assert.equal(claims,1);release();await first;run.stop();await run();assert.equal(claims,1);
});
test("a private PDF holds its deletion lock through rendering, releases on failure, and cannot render after erasure",async()=>{
  const calls=[];const db={async rpc(name,args){calls.push({name,args});return{data:name==="begin_life_letters_pdf"?"lease":true};}};
  await assert.rejects(withPrivatePdfLease(db,{id,survey_id:id,survey_revision:4},async()=>{throw Error("render failed");}),/render failed/);
  assert.equal(calls.at(-1).name,"finish_life_letters_pdf");
  let rendered=false;
  await assert.rejects(withPrivatePdfLease({rpc:async()=>({data:null})},{id,survey_id:id,survey_revision:4},async()=>{rendered=true;}));
  assert.equal(rendered,false);assert.throws(()=>requirePersonalizationAvailable({personalization_deleted_at:"now"}),e=>e.status===410);
  assert.equal(hasPhotoPermission({photo_permission_at:"now",photo_permission_version:"old"}),false);
  assert.equal(hasPhotoPermission({photo_permission_at:"now",photo_permission_version:PHOTO_PERMISSION_VERSION}),true);
});
test("retention administration requires a session, same-origin writes and all external-copy confirmations",async t=>{
  const calls=[];const db={rpc:async(name,args)=>{calls.push({name,args});return{data:name==="life_letters_retention_overview"?{jobs:[]}:true};}};
  const app=express().use(express.json()).use((req,_res,next)=>{req.session={isAdmin:req.headers["x-test-admin"]==="yes"};next();}).use(createRetentionAdminRouter({db,enabled:()=>true}));
  const server=app.listen(0,"127.0.0.1");await once(server,"listening");t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+"/api/admin/photo-retention")).status,401);
  const write=body=>fetch(base+`/api/admin/photo-retention/${id}/external-cleanup`,{method:"POST",headers:{"Content-Type":"application/json","x-test-admin":"yes"},body:JSON.stringify(body)});
  assert.equal((await write({canva:true})).status,400);
  assert.equal((await write({canva:true,workingCopies:true,trash:true})).status,200);
  assert.equal(calls.length,1);
  const bad=await fetch(base+`/api/admin/photo-retention/${id}/hold`,{method:"POST",headers:{"Content-Type":"application/json","x-test-admin":"yes",origin:"https://unrelated.example"},body:JSON.stringify({hold:false})});assert.equal(bad.status,403);
});
