(() => {
  const el=id=>document.getElementById(id);
  let photo=null,uploading=false,options,previewUrl=null;
  function status(message,error=false){el("childPhotoStatus").textContent=message;el("childPhotoStatus").classList.toggle("error",error);}
  function paint(){
    el("childPhotoPreview").hidden=!photo?.photoUrl;
    if(photo?.photoUrl)el("childPhotoPreview").src=photo.photoUrl;else el("childPhotoPreview").removeAttribute("src");
    el("childPhotoPlaceholder").hidden=!!photo?.photoUrl;
    el("removeChildPhoto").hidden=!photo;
    el("childPhotoPosition").hidden=!photo;
    const p=photo?.position||{x:50,y:50};
    el("childPhotoX").value=p.x;el("childPhotoY").value=p.y;
    el("childPhotoPreview").style.objectPosition=`${p.x}% ${p.y}%`;
  }
  function controls(){for(const id of ["chooseChildPhoto","removeChildPhoto","childPhotoFile","childPhotoX","childPhotoY"])el(id).disabled=uploading||options.isBlocked();}
  async function upload(file){
    if(!file||uploading||options.isBlocked())return false;
    const session=options.getSession();
    if(!session?.active){status("Open your private personalization form link to upload your child's photo.",true);return false;}
    if(!options.confirmPermission())return false;
    if(!["image/jpeg","image/png"].includes(file.type)||file.size>10*1024*1024){status("Choose a JPG or PNG photo no larger than 10 MB.",true);return false;}
    uploading=true;controls();options.update();status("Uploading your child's photo…");
    try{
      previewUrl=URL.createObjectURL(file);el("childPhotoPreview").src=previewUrl;el("childPhotoPreview").hidden=false;el("childPhotoPlaceholder").hidden=true;
      options.save();await session.flush();
      const body=new FormData();body.append("photo",file);
      const response=await fetch(`${session.path}/photos/TITLE`,{method:"POST",body});
      const data=await response.json();if(!response.ok)throw Error(data.error||"Could not upload the photo");
      photo={storagePath:data.storagePath,photoUrl:data.url,position:{x:50,y:50},...(data.warning?{warning:data.warning}:{})};
      paint();status('Saving your child’s photo…');
      try{await options.save();status(data.warning||"Photo saved. Adjust the circular preview if needed.");}
      catch{status('Photo uploaded. Save again before leaving this page.',true);}
      return true;
    }catch(error){paint();status(`${error.message}${photo?" Your previous photo is still selected.":""}`,true);return false;}
    finally{if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;uploading=false;el("childPhotoFile").value="";controls();options.update();}
  }
  window.LifeLettersChildPhoto={
    init(config){
      options=config;
      el("chooseChildPhoto").addEventListener("click",()=>{if(!options.isBlocked()&&options.confirmPermission())el("childPhotoFile").click();});
      el("childPhotoFile").addEventListener("change",e=>{const file=e.target.files[0];if(file)window.LifeLettersPhotoSaves.run('TITLE',()=>upload(file));});
      el("removeChildPhoto").addEventListener("click",()=>{if(uploading||options.isBlocked())return;this.reset();options.update();});
      for(const id of ["childPhotoX","childPhotoY"])el(id).addEventListener("input",()=>{
        if(!photo)return;photo.position={x:Number(el("childPhotoX").value),y:Number(el("childPhotoY").value)};el("childPhotoPreview").style.objectPosition=`${photo.position.x}% ${photo.position.y}%`;options.update();
      });
      paint();controls();
    },
    value(){return photo?{...photo,position:{...photo.position}}:null;},
    ready(){return !!photo?.storagePath&&!uploading;},
    restore(value){photo=value?.storagePath&&value?.photoUrl?{storagePath:value.storagePath,photoUrl:value.photoUrl,position:{x:value.position?.x??50,y:value.position?.y??50},...(value.warning?{warning:value.warning}:{})}:null;paint();if(photo)status(photo.warning||"Saved title-card photo restored.");},
    reset(){photo=null;window.LifeLettersPhotoSaves.clear('TITLE');paint();status("Upload your child's photo for the title card.");},
    lock(){controls();},
  };
})();
