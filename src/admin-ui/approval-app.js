const $=id=>document.getElementById(id);
const dateText=value=>value?new Date(value).toLocaleString('zh-CN'):'???';
const message=(value,error=false)=>{$('actionMessage').textContent=value;$('actionMessage').classList.toggle('error',error);};
let setupMode=false,applications=[],recordingName='',recordedBlob=null,recordedUrl='',recordingBusy=false;
const statusText={pending:'???',approved:'???',rejected:'???',unbound:'???',expired:'???'};
function showAuth(needsSetup){
  setupMode=needsSetup;$('authPage').hidden=false;$('workspace').hidden=true;$('lockButton').hidden=true;
  $('authTitle').textContent=needsSetup?'?????????':'?????';
  $('authIntro').textContent=needsSetup?'???? 8 ??????????????':'???????????????????';
  $('confirmationField').hidden=!needsSetup;$('confirmationInput').required=needsSetup;
  $('authButton').textContent=needsSetup?'???????':'?????';
  $('passwordInput').value='';$('confirmationInput').value='';$('authMessage').textContent='';$('passwordInput').focus();
}
function showWorkspace(){
  $('authPage').hidden=true;$('workspace').hidden=false;$('lockButton').hidden=false;setPage('applicationsPage');loadApplications();
}
function setPage(id){
  document.querySelectorAll('.admin-page').forEach(page=>page.hidden=page.id!==id);
  document.querySelectorAll('.admin-tab').forEach(tab=>tab.classList.toggle('active',tab.dataset.page===id));
  if(id==='wallpapersPage')loadWallpapers();
  if(id==='legacyPage')loadLegacy();
}
async function act(button,task,success){
  button.disabled=true;try{const result=await task();if(result){message(success);return result;}return null;}
  catch(error){message(error.message,true);return null;}finally{button.disabled=false;}
}
const el=(tag,text,className)=>{const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node;};
const button=(text,handler,cls='')=>{const node=el('button',text,cls);node.type='button';node.addEventListener('click',handler);return node;};
const expiryIso=date=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('??????????');return new Date(`${date}T23:59:59+08:00`).toISOString();};
function defaultDate(){const date=new Date(Date.now()+30*86400000);return date.toISOString().slice(0,10);}
async function change(item,action,data,success){
  const result=await window.licenseAdmin.applicationAction({id:item.id,action,data});
  if(result){await loadApplications();message(success);}return result;
}
function renderApplications(){
  const pending=$('applicationList'),bindings=$('bindingList');pending.replaceChildren();bindings.replaceChildren();
  const pendingItems=applications.filter(item=>item.status==='pending');
  const otherItems=applications.filter(item=>item.status!=='pending');
  if(!pendingItems.length)pending.append(el('p','???????','empty'));
  if(!otherItems.length)bindings.append(el('p','?????????','empty'));
  for(const item of applications){
    const row=el('article','', 'binding-row');
    const top=el('div','', 'binding-top');top.append(el('strong',item.name||'???'),el('span',statusText[item.status]||item.status,`status ${item.status==='approved'?'active':''}`));
    const pair=el('div','', 'binding-pair');pair.append(el('code',`??? ${item.phone}`),el('code',`??? ${item.machineCode}`));
    const meta=el('small',`?? ${dateText(item.createdAt)}${item.expiresAt?` ? ?? ${dateText(item.expiresAt)}`:''}${item.reason?` ? ?? ${item.reason}`:''}`);
    const actions=el('div','', 'binding-actions');
    const nameInput=document.createElement('input');nameInput.value=item.name||'';nameInput.maxLength=40;nameInput.placeholder='????';nameInput.setAttribute('aria-label','????');
    actions.append(nameInput,button('????',async event=>{await act(event.currentTarget,()=>change(item,'rename',{name:nameInput.value},'?????'),'?????');}));
    if(item.status==='pending'){
      const date=document.createElement('input');date.type='date';date.value=defaultDate();date.setAttribute('aria-label','??????');
      actions.append(date,button('????',async event=>{await act(event.currentTarget,()=>change(item,'approve',{expiresAt:expiryIso(date.value)},'?????'),'?????');}));
      actions.append(button('??',async event=>{
        await act(event.currentTarget,()=>change(item,'reject',{reason:'?????'},'?????'),'?????');
      },'danger'));
    }
    if(item.status==='approved'){
      const date=document.createElement('input');date.type='date';date.value=item.expiresAt?.slice(0,10)||defaultDate();date.setAttribute('aria-label','??????');
      actions.append(date,button('????',async event=>{await act(event.currentTarget,()=>change(item,'expiry',{expiresAt:expiryIso(date.value)},'?????'),'?????');}));
      actions.append(button('??',async event=>{await act(event.currentTarget,()=>change(item,'unbind',{},'?????'),'?????');}));
      const candidates=applications.filter(other=>other.status==='pending'&&other.phone===item.phone&&other.machineCode!==item.machineCode);
      if(candidates.length){
        const select=document.createElement('select');select.setAttribute('aria-label','????');
        for(const candidate of candidates){const option=document.createElement('option');option.value=candidate.id;option.textContent=`${candidate.machineCode} ? ${dateText(candidate.createdAt)}`;select.append(option);}
        actions.append(select,button('??????',async event=>{await act(event.currentTarget,()=>change(item,'rebind',{targetId:select.value},'???????'),'???????');}));
      }
    }
    actions.append(button('??????',async event=>{await act(event.currentTarget,()=>change(item,'delete',{},'?????'),'?????');},'danger'));
    row.append(top,pair,meta,actions);(item.status==='pending'?pending:bindings).append(row);
  }
}
async function loadApplications(){
  try{
    const items=[];let offset=0,total=0;
    do{const page=await window.licenseAdmin.applications({offset,limit:200});items.push(...page.items);total=page.total;offset=items.length;}while(offset<total);
    applications=items;renderApplications();message(`??? ${items.length} ???????`);
  }catch(error){message(error.message,true);}
}
async function loadLegacy(){
  const host=$('legacyList');host.replaceChildren();
  try{const items=await window.licenseAdmin.legacyHistory();if(!items.length)host.append(el('p','??????','empty'));
    for(const item of items){const row=el('article','', 'binding-row');row.append(el('strong',item.name||'?????'),el('code',`?? ${item.key} ? ??? ${item.machineCode}`),el('small',`?? ${dateText(item.expiresAt)}`));host.append(row);}}
  catch(error){message(error.message,true);}
}
document.querySelectorAll('.admin-tab').forEach(tab=>tab.addEventListener('click',()=>setPage(tab.dataset.page)));
$('authForm').addEventListener('submit',async event=>{
  event.preventDefault();const submit=$('authButton');submit.disabled=true;
  try{const password=$('passwordInput').value;if(setupMode)await window.licenseAdmin.setup({password,confirmation:$('confirmationInput').value});else await window.licenseAdmin.unlock(password);showWorkspace();}
  catch(error){$('authMessage').textContent=error.message;}finally{submit.disabled=false;}
});
$('lockButton').addEventListener('click',async()=>{const state=await window.licenseAdmin.lock();applications=[];$('applicationList').replaceChildren();$('bindingList').replaceChildren();$('legacyList').replaceChildren();showAuth(state.needsSetup);});
$('reloadApplications').addEventListener('click',loadApplications);
$('reloadBindings').addEventListener('click',loadApplications);
setInterval(()=>{if(!$('workspace').hidden)loadApplications();},20000);

const wallpaperUrl=item=>item.storage==='release'?
  `https://github.com/guanchenli79-bit/image-workbench/releases/download/wallpaper-library/${item.path.split('/').pop()}`:
  `https://raw.githubusercontent.com/guanchenli79-bit/image-workbench/license-registry/${item.path}?v=${item.sha256}`;
function showWallpapers(manifest){
  const host=$('wallpaperList');host.replaceChildren();
  for(const item of manifest.items){
    const card=document.createElement('article');card.className='wallpaper-card';
    const preview=document.createElement('div');preview.className='wallpaper-preview';
    if(item.kind==='image'){const img=document.createElement('img');img.src=wallpaperUrl(item);img.alt=item.name;preview.append(img);}
    else if(item.kind==='video'){const video=document.createElement('video');video.src=wallpaperUrl(item);video.muted=true;video.loop=true;video.autoplay=true;video.playsInline=true;preview.append(video);}
    else preview.textContent='?';
    const content=document.createElement('div');content.className='wallpaper-copy';
    const name=document.createElement('strong');name.textContent=item.name;
    const meta=document.createElement('small');meta.textContent=item.id===manifest.activeId?'????????':item.kind==='bundled'?'??????':item.kind==='video'?'??????':'??????';
    const actions=document.createElement('div');actions.className='wallpaper-actions';
    const select=document.createElement('button');select.type='button';select.textContent=item.id===manifest.activeId?'????':'????';select.disabled=item.id===manifest.activeId;
    select.addEventListener('click',async()=>{const updated=await act(select,()=>window.licenseAdmin.selectWallpaper(item.id),'????????????????');if(updated)showWallpapers(updated);});
    actions.append(select);
    if(item.id!=='original'){
      const remove=document.createElement('button');remove.type='button';remove.className='danger';remove.textContent='??';
      remove.addEventListener('click',async()=>{const updated=await act(remove,()=>window.licenseAdmin.deleteWallpaper(item.id),'?????????');if(updated)showWallpapers(updated);});
      actions.append(remove);
    }
    content.append(name,meta,actions);card.append(preview,content);host.append(card);
  }
}
async function loadWallpapers(){try{showWallpapers(await window.licenseAdmin.wallpapers());}catch(error){$('wallpaperList').textContent='?????????';message(error.message,true);}}

$('reloadWallpapers').addEventListener('click',loadWallpapers);
$('addWallpaper').addEventListener('click',async event=>{const updated=await act(event.currentTarget,()=>window.licenseAdmin.addWallpaper(),'?????????');if(updated)showWallpapers(updated);});
$('importScene').addEventListener('click',async event=>{
  const button=event.currentTarget;button.disabled=true;
  try{
    const result=await window.licenseAdmin.importScene();
    if(!result)return;
    if(result.manifest){showWallpapers(result.manifest);message('?????????????');return;}
    recordingName=result.recording.title;
    $('recordingTitle').textContent=`???${recordingName}?`;
    $('recordingStatus').textContent='??? Wallpaper Engine ???????';
    $('recordingModal').hidden=false;
  }catch(error){message(error.message,true);}finally{button.disabled=false;}
});
function clearRecording(){
  recordedBlob=null;
  if(recordedUrl){URL.revokeObjectURL(recordedUrl);recordedUrl='';}
  $('recordingPreview').pause();$('recordingPreview').removeAttribute('src');$('recordingPreview').hidden=true;
  $('publishRecording').hidden=true;
}
$('closeRecording').addEventListener('click',()=>{if(recordingBusy)return;clearRecording();$('recordingModal').hidden=true;});
$('startRecording').addEventListener('click',async()=>{
  if(recordingBusy)return;
  recordingBusy=true;clearRecording();$('startRecording').disabled=true;$('closeRecording').disabled=true;
  let stream;
  try{
    $('recordingStatus').textContent='???????????';
    stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:20,width:{ideal:1920},height:{ideal:1080}},audio:false});
    const mimeType=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(value=>MediaRecorder.isTypeSupported(value));
    if(!mimeType)throw new Error('????????? WEBM ??');
    const chunks=[];
    const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:2500000});
    const completed=new Promise((resolve,reject)=>{
      recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
      recorder.onerror=event=>reject(event.error||new Error('????'));
      recorder.onstop=resolve;
    });
    $('recordingStatus').textContent='?????????? 8 ??';
    await window.licenseAdmin.hideForRecording();
    await new Promise(resolve=>setTimeout(resolve,600));
    recorder.start();
    await new Promise(resolve=>setTimeout(resolve,8000));
    recorder.stop();
    await completed;
    recordedBlob=new Blob(chunks,{type:'video/webm'});
    if(recordedBlob.size<100||recordedBlob.size>25*1024*1024)throw new Error('???????????????');
    recordedUrl=URL.createObjectURL(recordedBlob);
    $('recordingPreview').src=recordedUrl;$('recordingPreview').hidden=false;
    $('publishRecording').hidden=false;
    $('recordingStatus').textContent=`???? ? ${(recordedBlob.size/1024/1024).toFixed(1)} MB??????????`;
  }catch(error){clearRecording();$('recordingStatus').textContent=`?????${error.message}`;}
  finally{
    stream?.getTracks().forEach(track=>track.stop());
    await window.licenseAdmin.showAfterRecording().catch(()=>{});
    recordingBusy=false;$('startRecording').disabled=false;$('closeRecording').disabled=false;
  }
});
$('publishRecording').addEventListener('click',async()=>{
  if(!recordedBlob||recordingBusy)return;
  recordingBusy=true;$('publishRecording').disabled=true;$('closeRecording').disabled=true;
  $('recordingStatus').textContent='????????????';
  try{
    const bytes=new Uint8Array(await recordedBlob.arrayBuffer());
    const manifest=await window.licenseAdmin.publishRecording({bytes,name:recordingName});
    showWallpapers(manifest);message('????????????????????????');
    clearRecording();$('recordingModal').hidden=true;
  }catch(error){$('recordingStatus').textContent=`?????${error.message}`;}
  finally{recordingBusy=false;$('publishRecording').disabled=false;$('closeRecording').disabled=false;}
});

window.licenseAdmin.status().then(state=>state.unlocked?showWorkspace():showAuth(state.needsSetup)).catch(error=>{document.getElementById('authPage').hidden=false;document.getElementById('authMessage').textContent=error.message;});
