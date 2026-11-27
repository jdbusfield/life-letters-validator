import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
test('confirmation requires explicit submit; Keep Editing and Escape do not submit',async()=>{
 let close;const dialog={returnValue:'',addEventListener(event,fn){if(event==='close')close=fn;},showModal(){this.open=true;}};
 const context=vm.createContext({document:{addEventListener(){},getElementById(){return dialog;}}});
 vm.runInContext(source,context);
 for(const choice of ['cancel','','submit']){
  const result=vm.runInContext('confirmCardSubmission()',context);
  assert.equal(dialog.returnValue,'cancel');
  dialog.returnValue=choice;close();assert.equal(await result,choice==='submit');
 }
});
test('double taps cannot launch two submission flows and the guard resets',async()=>{
 const context=vm.createContext({document:{addEventListener(){}},calls:0});vm.runInContext(source,context);
 vm.runInContext('submitOrderOnce=()=>{calls++;return new Promise(resolve=>release=resolve);}',context);
 const first=vm.runInContext('submitOrder()',context);await vm.runInContext('submitOrder()',context);assert.equal(context.calls,1);
 context.release();await first;
 const next=vm.runInContext('submitOrder()',context);assert.equal(context.calls,2);context.release();await next;
});
