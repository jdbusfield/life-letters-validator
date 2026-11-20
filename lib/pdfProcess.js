import {fork} from "node:child_process";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
let tail=Promise.resolve();
export function renderInProcess(order,entries){
 const task=tail.catch(()=>{}).then(()=>run(order,entries));tail=task.then(()=>{},()=>{});return task;
}
async function run(order,entries){
 const dir=await mkdtemp(join(tmpdir(),"life-letters-pdf-")),output=join(dir,"cards.pdf");
 try {
  await new Promise((resolve,reject)=>{
   const child=fork(new URL("./pdfRenderWorker.js",import.meta.url),[],{execArgv:["--max-old-space-size=192"],env:{...process.env,MALLOC_ARENA_MAX:"2"},stdio:["ignore","inherit","inherit","ipc"]});
   const timeout=setTimeout(()=>{child.kill("SIGKILL");},180000);let completed=false;
   child.on("message",m=>{if(m?.ready===true)completed=true;});
   child.once("error",reject);
   child.once("exit",code=>{clearTimeout(timeout);code===0&&completed?resolve():reject(Error("PDF rendering did not finish. Please retry from the admin dashboard."));});
   child.send({order,entries,output});
  });
  return await readFile(output);
 }finally{await rm(dir,{recursive:true,force:true});}
}
