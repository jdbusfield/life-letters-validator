import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const trackerSource=await readFile(new URL('../public/photo-saves.js',import.meta.url),'utf8');
const appSource=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
function fixture(){
 const listeners={},button={innerHTML:'Save & Finish Later',disabled:false};
 const context=vm.createContext({window:{addEventListener(n,f){listeners[n]=f;}},document:{addEventListener(){},getElementById(){return button;}},console,clearTimeout(){}});
 vm.runInContext(trackerSource,context);vm.runInContext(appSource,context);
 vm.runInContext('updateSubmitButton=()=>{};saveProgress=async()=>{snapshots.push({...current});};surveySession={active:true,flush:async()=>{},notice:(message)=>notices.push(message)};showToast=message=>notices.push(message);',context);
 context.snapshots=[];context.notices=[];context.current={word:'apple',photo:null};
 return {context,tracker:context.window.LifeLettersPhotoSaves,button,listeners};
}
test('Save waits for simultaneous letter and title uploads before saving the latest snapshot',async()=>{
 const f=fixture();let finishLetter,finishTitle;
 const a=f.tracker.run('A',()=>new Promise(r=>{finishLetter=()=>{f.context.current.photo='stored-A';r(true);};}));
 const title=f.tracker.run('TITLE',()=>new Promise(r=>{finishTitle=()=>{f.context.current.title='stored-title';r(true);};}));
 const saving=vm.runInContext('handleManualSave()',f.context);
 await Promise.resolve();assert.equal(f.button.disabled,true);assert.equal(f.context.snapshots.length,0);
 finishLetter();await a;assert.equal(f.context.snapshots.length,0);
 finishTitle();await title;await saving;
 assert.equal(f.context.snapshots[0].photo,'stored-A');assert.equal(f.context.snapshots[0].title,'stored-title');
 assert.match(f.context.notices.at(-1),/All photos and answers are saved online/);assert.equal(f.button.disabled,false);
});
test('Save never reports all photos saved after a failed upload; a successful retry clears failure',async()=>{
 const f=fixture();await f.tracker.run('C',async()=>false);
 await vm.runInContext('handleManualSave()',f.context);
 assert.match(f.context.notices.at(-1),/retry the photo upload for: c/);
 await f.tracker.run('C',async()=>true);await vm.runInContext('handleManualSave()',f.context);
 assert.match(f.context.notices.at(-1),/All photos and answers are saved online/);
});
test('navigation protection covers active file transfers',async()=>{
 const f=fixture();let release;const task=f.tracker.run('A',()=>new Promise(r=>{release=r;}));await Promise.resolve();
 let warned=false;f.listeners.beforeunload({preventDefault(){warned=true;}});assert.equal(warned,true);release(true);await task;
 warned=false;f.listeners.beforeunload({preventDefault(){warned=true;}});assert.equal(warned,false);
});
test('online save failure produces no saved-success claim',async()=>{
 const f=fixture();vm.runInContext('saveProgress=async()=>{throw Error("Connection interrupted. Keep this tab open.");}',f.context);
 await vm.runInContext('handleManualSave()',f.context);
 assert.match(f.context.notices.at(-1),/Keep this tab open/);assert.equal(f.button.disabled,false);
});
