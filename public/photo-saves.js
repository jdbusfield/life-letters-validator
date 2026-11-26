// Save and navigation must account for file transfers, not just draft PUTs.
window.LifeLettersPhotoSaves=(()=>{
 const pending=new Map(),failed=new Set();
 return {
  busy(key){return key?pending.has(key):pending.size>0;},
  clear(key){failed.delete(key);},
  fail(key){failed.add(key);},
  run(key,work){
   if(pending.has(key))return pending.get(key);
   failed.delete(key);
   const task=Promise.resolve().then(work).then(ok=>{if(ok===false)failed.add(key);return ok;},()=>{failed.add(key);return false;}).finally(()=>{pending.delete(key);window.onLifeLettersPhotoSettled?.();});
   pending.set(key,task);window.onLifeLettersPhotoSettled?.();return task;
  },
  async settle(){while(pending.size)await Promise.all([...pending.values()]);return [...failed];},
 };
})();
window.addEventListener('beforeunload',event=>{
 if(window.LifeLettersPhotoSaves.busy()){event.preventDefault();event.returnValue='';}
});
