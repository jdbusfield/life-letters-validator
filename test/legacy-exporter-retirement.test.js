import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {legacyExporterRetirement,CURRENT_SURVEY_ADMIN} from "../lib/legacyExporterRetirement.js";
import {generateOrderPDF} from "../lib/pdfGenerator.js";
test("retired generator refuses orders before rendering or storage",async()=>{
  await assert.rejects(generateOrderPDF({id:"any-order"},[]),e=>e.code==="legacy_exporter_retired"&&e.status===410);
});
test("old export routes cannot reach a renderer and old admin redirects",async()=>{
  const app=express();app.use(legacyExporterRetirement);app.use((_req,res)=>res.json({reached:true}));
  const server=app.listen(0,"127.0.0.1");await new Promise(resolve=>server.once("listening",resolve));
  try{
    const base="http://127.0.0.1:"+server.address().port;
    for(const [method,path]of [["GET","/api/admin/export/example"],["GET","/api/admin/orders/example/pdf"],["POST","/api/admin/orders/example/regenerate-pdf"]]){
      const r=await fetch(base+path,{method});assert.equal(r.status,410);assert.equal((await r.json()).currentAdmin,CURRENT_SURVEY_ADMIN);
    }
    const admin=await fetch(base+"/admin",{redirect:"manual"});assert.equal(admin.status,302);assert.equal(admin.headers.get("location"),CURRENT_SURVEY_ADMIN);
    const status=await fetch(base+"/api/admin/export-status");assert.equal((await status.json()).retired,true);
    assert.equal((await(await fetch(base+"/")).json()).reached,true);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
