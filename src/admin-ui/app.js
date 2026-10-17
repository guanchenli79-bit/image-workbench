const $=id=>document.getElementById(id);
const dateText=value=>new Date(value).toLocaleString('zh-CN');
const message=(value,error=false)=>{$('actionMessage').textContent=value;$('actionMessage').classList.toggle('error',error);};
let setupMode=false;
let snapshot={entries:[],bindings:[]};
let recordingName='';
let recordedBlob=null;
let recordedUrl='';
let recordingBusy=false;

function showAuth(needsSetup){
  setupMode=needsSetup;
  $('authPage').hidden=false;$('workspace').hidden=true;$('lockButton').hidden=true;
  $('authTitle').textContent=needsSetup?'首次设置管理员密码':'管理员登录';
  $('authIntro').textContent=needsSetup?'设置至少 8 位密码；加密的绑定记录保存在本机，请妥善保管密码与管理机。':'输入管理员密码后，才能查看和管理卡密。';
  $('confirmationField').hidden=!needsSetup;$('confirmationInput').required=needsSetup;
  $('passwordInput').autocomplete=needsSetup?'new-password':'current-password';
  $('authButton').textContent=needsSetup?'设置密码并进入':'进入管理端';
  $('passwordInput').value='';$('confirmationInput').value='';$('authMessage').textContent='';
  $('passwordInput').focus();
}
function showWorkspace(){
  $('authPage').hidden=true;$('workspace').hidden=false;$('lockButton').hidden=false;
  setPage('issuePage');loadLicenses();
}
function setPage(id){
  document.querySelectorAll('.admin-page').forEach(page=>page.hidden=page.id!==id);
  document.querySelectorAll('.admin-tab').forEach(tab=>tab.classList.toggle('active',tab.dataset.page===id));
  if(id==='wallpapersPage')loadWallpapers();
  if(id==='bindingsPage'&&!snapshot.bindings.length)loadLicenses();
}
async function act(button,task,success){
  button.disabled=true;
  try{const result=await task();if(result){message(success);return result;}return null;}
  catch(error){message(error.message,true);return null;}
  finally{button.disabled=false;}
}
function showEntries(entries){
  const host=$('licenseList');host.replaceChildren();
  if(!entries.length){host.textContent='当前没有有效授权';return;}
  for(const entry of entries){
    const row=document.createElement('div');row.className='license-row';
    const body=document.createElement('div');body.className='license-info';
    const name=document.createElement('strong');name.textContent=entry.name||'未命名机器';
    const hash=document.createElement('small');hash.textContent=`机器哈希 ${entry.machineHash.slice(0,12).toUpperCase()}…`;
    const expiry=document.createElement('small');expiry.textContent=`到期 ${dateText(entry.expiresAt)}`;
    body.append(name,hash,expiry);row.append(body);host.append(row);
  }
}
function showBindings(items){
  const host=$('bindingList');host.replaceChildren();
  if(!items.length){host.textContent='暂无绑定记录。签发卡密后会自动保存在这里。';return;}
  for(const item of items){
    const row=document.createElement('article');row.className='binding-row';
    const top=document.createElement('div');top.className='binding-top';
    const title=document.createElement('strong');title.textContent=item.name||'未命名用户';
    const status=document.createElement('span');status.className=`status ${item.status==='有效'?'active':''}`;status.textContent=item.status||'未联网确认';
    top.append(title,status);
    const pair=document.createElement('div');pair.className='binding-pair';
    const code=document.createElement('code');code.textContent=`卡密 ${item.key}`;
    const machine=document.createElement('code');machine.textContent=`机器码 ${item.machineCode}`;
    pair.append(code,machine);
    const dates=document.createElement('small');dates.textContent=`签发 ${dateText(item.issuedAt)} · 到期 ${dateText(item.expiresAt)}`;
    const edit=document.createElement('div');edit.className='binding-edit';
    const nameInput=document.createElement('input');nameInput.value=item.name||'';nameInput.maxLength=40;nameInput.placeholder='备注名称';nameInput.setAttribute('aria-label','备注名称');
    const saveName=document.createElement('button');saveName.type='button';saveName.textContent='保存名称';
    saveName.addEventListener('click',async()=>{
      try{const updated=await window.licenseAdmin.rename({machineHash:item.machineHash,name:nameInput.value});item.name=updated;title.textContent=updated||'未命名用户';message('名称已保存到加密管理库');}
      catch(error){message(error.message,true);}
    });
    const copy=document.createElement('button');copy.type='button';copy.textContent='复制卡密';
    copy.addEventListener('click',()=>act(copy,()=>window.licenseAdmin.copy(item.key),'卡密已复制'));
    edit.append(nameInput,saveName,copy);
    const actions=document.createElement('div');actions.className='binding-actions';
    const newMachine=document.createElement('input');newMachine.placeholder='输入新的完整机器码';newMachine.setAttribute('aria-label','新机器码');
    const rebind=document.createElement('button');rebind.type='button';rebind.textContent='换绑机器';
    rebind.addEventListener('click',async()=>{const result=await act(rebind,()=>window.licenseAdmin.rebind({key:item.key,machineCode:newMachine.value}),'卡密已改绑到新机器');if(result)showSnapshot(result);});
    actions.append(newMachine,rebind);
    if(item.status==='有效'){
      const unbind=document.createElement('button');unbind.type='button';unbind.textContent='解绑';
      unbind.addEventListener('click',async()=>{const result=await act(unbind,()=>window.licenseAdmin.unbind(item.machineHash),'机器已解绑，记录继续保留');if(result)showSnapshot(result);});
      actions.append(unbind);
    }
    const remove=document.createElement('button');remove.type='button';remove.className='danger';remove.textContent='永久删除记录';
    remove.addEventListener('click',async()=>{const result=await act(remove,()=>window.licenseAdmin.deleteBinding(item.key),'绑定记录已永久删除');if(result)showSnapshot(result);});
    actions.append(remove);
    row.append(top,pair,dates,edit,actions);host.append(row);
  }
}
function showSnapshot(value){snapshot=value;showEntries(value.entries||[]);showBindings(value.bindings||[]);}
async function loadLicenses(){
  try{showSnapshot(await window.licenseAdmin.list());message('授权库与本机绑定记录已同步');}
  catch(error){
    try{showBindings((await window.licenseAdmin.localBindings()).map(item=>({...item,status:'未联网确认'})));}
    catch{$('bindingList').textContent='本机绑定记录读取失败';}
    $('licenseList').textContent='在线授权库暂不可用';message(error.message,true);
  }
}
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
    else preview.textContent='✦';
    const content=document.createElement('div');content.className='wallpaper-copy';
    const name=document.createElement('strong');name.textContent=item.name;
    const meta=document.createElement('small');meta.textContent=item.id===manifest.activeId?'当前所有用户使用':item.kind==='bundled'?'内置动态壁纸':item.kind==='video'?'动态视频壁纸':'静态图片壁纸';
    const actions=document.createElement('div');actions.className='wallpaper-actions';
    const select=document.createElement('button');select.type='button';select.textContent=item.id===manifest.activeId?'当前壁纸':'设为当前';select.disabled=item.id===manifest.activeId;
    select.addEventListener('click',async()=>{const updated=await act(select,()=>window.licenseAdmin.selectWallpaper(item.id),'已发布壁纸切换，用户端将自动同步');if(updated)showWallpapers(updated);});
    actions.append(select);
    if(item.id!=='original'){
      const remove=document.createElement('button');remove.type='button';remove.className='danger';remove.textContent='删除';
      remove.addEventListener('click',async()=>{const updated=await act(remove,()=>window.licenseAdmin.deleteWallpaper(item.id),'壁纸已从远程库删除');if(updated)showWallpapers(updated);});
      actions.append(remove);
    }
    content.append(name,meta,actions);card.append(preview,content);host.append(card);
  }
}
async function loadWallpapers(){try{showWallpapers(await window.licenseAdmin.wallpapers());}catch(error){$('wallpaperList').textContent='远程壁纸库加载失败';message(error.message,true);}}
function defaultDate(){const date=new Date();date.setDate(date.getDate()+30);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
$('expiryInput').value=defaultDate();
document.querySelectorAll('.admin-tab').forEach(tab=>tab.addEventListener('click',()=>setPage(tab.dataset.page)));
$('authForm').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('authButton');button.disabled=true;
  try{const password=$('passwordInput').value;if(setupMode)await window.licenseAdmin.setup({password,confirmation:$('confirmationInput').value});else await window.licenseAdmin.unlock(password);$('passwordInput').value='';$('confirmationInput').value='';showWorkspace();}
  catch(error){$('authMessage').textContent=error.message;}
  finally{button.disabled=false;}
});
$('lockButton').addEventListener('click',async()=>{try{const status=await window.licenseAdmin.lock();$('issuedKey').textContent='';$('issuedResult').hidden=true;snapshot={entries:[],bindings:[]};$('licenseList').replaceChildren();$('bindingList').replaceChildren();$('wallpaperList').replaceChildren();showAuth(status.needsSetup);}catch(error){message(error.message,true);}});
$('reloadList').addEventListener('click',loadLicenses);$('reloadBindings').addEventListener('click',loadLicenses);$('reloadWallpapers').addEventListener('click',loadWallpapers);
$('useOwnMachine').addEventListener('click',async()=>{try{$('machineInput').value=await window.licenseAdmin.ownMachine();}catch(error){message(error.message,true);}});
$('issueForm').addEventListener('submit',async event=>{
  event.preventDefault();const button=$('issueButton');button.disabled=true;button.textContent='正在签发并同步…';
  try{const result=await window.licenseAdmin.issue({machineCode:$('machineInput').value,date:$('expiryInput').value,name:$('nameInput').value});$('issuedKey').textContent=result.key;$('issuedExpiry').textContent=`有效期至 ${dateText(result.expiresAt)}`;$('issuedResult').hidden=false;showSnapshot(result);message(result.warning||'签发成功，卡密和机器码已保存到绑定管理',Boolean(result.warning));}
  catch(error){message(error.message,true);}
  finally{button.disabled=false;button.innerHTML='生成并同步卡密 <span>↗</span>';}
});
$('copyIssuedKey').addEventListener('click',async()=>{try{await window.licenseAdmin.copy($('issuedKey').textContent);message('卡密已复制');}catch(error){message(error.message,true);}});
$('addWallpaper').addEventListener('click',async event=>{const updated=await act(event.currentTarget,()=>window.licenseAdmin.addWallpaper(),'壁纸已添加到远程库');if(updated)showWallpapers(updated);});
$('importScene').addEventListener('click',async event=>{
  const button=event.currentTarget;button.disabled=true;
  try{
    const result=await window.licenseAdmin.importScene();
    if(!result)return;
    if(result.manifest){showWallpapers(result.manifest);message('动态视频壁纸已添加到远程库');return;}
    recordingName=result.recording.title;
    $('recordingTitle').textContent=`录制「${recordingName}」`;
    $('recordingStatus').textContent='请先在 Wallpaper Engine 中设为当前壁纸';
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
    $('recordingStatus').textContent='正在获取主显示器画面…';
    stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:20,width:{ideal:1920},height:{ideal:1080}},audio:false});
    const mimeType=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(value=>MediaRecorder.isTypeSupported(value));
    if(!mimeType)throw new Error('当前管理端无法录制 WEBM 视频');
    const chunks=[];
    const recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:2500000});
    const completed=new Promise((resolve,reject)=>{
      recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
      recorder.onerror=event=>reject(event.error||new Error('录制失败'));
      recorder.onstop=resolve;
    });
    $('recordingStatus').textContent='管理端即将隐藏，录制 8 秒…';
    await window.licenseAdmin.hideForRecording();
    await new Promise(resolve=>setTimeout(resolve,600));
    recorder.start();
    await new Promise(resolve=>setTimeout(resolve,8000));
    recorder.stop();
    await completed;
    recordedBlob=new Blob(chunks,{type:'video/webm'});
    if(recordedBlob.size<100||recordedBlob.size>25*1024*1024)throw new Error('录制文件大小不符合要求，请重试');
    recordedUrl=URL.createObjectURL(recordedBlob);
    $('recordingPreview').src=recordedUrl;$('recordingPreview').hidden=false;
    $('publishRecording').hidden=false;
    $('recordingStatus').textContent=`录制完成 · ${(recordedBlob.size/1024/1024).toFixed(1)} MB。请检查画面后上传。`;
  }catch(error){clearRecording();$('recordingStatus').textContent=`录制失败：${error.message}`;}
  finally{
    stream?.getTracks().forEach(track=>track.stop());
    await window.licenseAdmin.showAfterRecording().catch(()=>{});
    recordingBusy=false;$('startRecording').disabled=false;$('closeRecording').disabled=false;
  }
});
$('publishRecording').addEventListener('click',async()=>{
  if(!recordedBlob||recordingBusy)return;
  recordingBusy=true;$('publishRecording').disabled=true;$('closeRecording').disabled=true;
  $('recordingStatus').textContent='正在上传并登记动态壁纸…';
  try{
    const bytes=new Uint8Array(await recordedBlob.arrayBuffer());
    const manifest=await window.licenseAdmin.publishRecording({bytes,name:recordingName});
    showWallpapers(manifest);message('动态壁纸已上传；点击“设为当前”即可让用户端同步');
    clearRecording();$('recordingModal').hidden=true;
  }catch(error){$('recordingStatus').textContent=`上传失败：${error.message}`;}
  finally{recordingBusy=false;$('publishRecording').disabled=false;$('closeRecording').disabled=false;}
});
window.licenseAdmin.status().then(status=>status.unlocked?showWorkspace():showAuth(status.needsSetup)).catch(error=>{$('authPage').hidden=false;$('authMessage').textContent=error.message;});
