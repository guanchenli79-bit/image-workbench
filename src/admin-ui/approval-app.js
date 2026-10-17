const $=id=>document.getElementById(id);
const dateText=value=>value?new Date(value).toLocaleString('zh-CN'):'未设置';
const message=(value,error=false)=>{$('actionMessage').textContent=value;$('actionMessage').classList.toggle('error',error);};
let setupMode=false,applications=[],recordingName='',recordedBlob=null,recordedUrl='',recordingBusy=false;
const statusText={pending:'待审批',approved:'已绑定',rejected:'已驳回',unbound:'已解绑',expired:'已到期'};
function showAuth(needsSetup){
  setupMode=needsSetup;$('authPage').hidden=false;$('workspace').hidden=true;$('lockButton').hidden=true;
  $('authTitle').textContent=needsSetup?'首次设置管理员密码':'管理员登录';
  $('authIntro').textContent=needsSetup?'设置至少 8 位密码，保留旧版加密管理库。':'输入管理员密码后，查看申请和管理绑定。';
  $('confirmationField').hidden=!needsSetup;$('confirmationInput').required=needsSetup;
  $('authButton').textContent=needsSetup?'设置密码并进入':'进入管理端';
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
const expiryIso=date=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('请选择有效期截止日期');return new Date(`${date}T23:59:59+08:00`).toISOString();};
function defaultDate(){const date=new Date(Date.now()+30*86400000);return date.toISOString().slice(0,10);}
async function change(item,action,data,success){
  const result=await window.licenseAdmin.applicationAction({id:item.id,action,data});
  if(result){await loadApplications();message(success);}return result;
}
function renderApplications(){
  const pending=$('applicationList'),bindings=$('bindingList');pending.replaceChildren();bindings.replaceChildren();
  const pendingItems=applications.filter(item=>item.status==='pending');
  const otherItems=applications.filter(item=>item.status!=='pending');
  if(!pendingItems.length)pending.append(el('p','暂无待审批申请','empty'));
  if(!otherItems.length)bindings.append(el('p','暂无绑定或历史记录','empty'));
  for(const item of applications){
    const row=el('article','', 'binding-row');
    const top=el('div','', 'binding-top');top.append(el('strong',item.name||'未命名'),el('span',statusText[item.status]||item.status,`status ${item.status==='approved'?'active':''}`));
    const pair=el('div','', 'binding-pair');pair.append(el('code',`手机号 ${item.phone}`),el('code',`机器码 ${item.machineCode}`));
    const meta=el('small',`申请 ${dateText(item.createdAt)}${item.expiresAt?` · 到期 ${dateText(item.expiresAt)}`:''}${item.reason?` · 原因 ${item.reason}`:''}`);
    const actions=el('div','', 'binding-actions');
    const nameInput=document.createElement('input');nameInput.value=item.name||'';nameInput.maxLength=40;nameInput.placeholder='备注名称';nameInput.setAttribute('aria-label','备注名称');
    actions.append(nameInput,button('保存名称',async event=>{await act(event.currentTarget,()=>change(item,'rename',{name:nameInput.value},'名称已保存'),'名称已保存');}));
    if(item.status==='pending'){
      const date=document.createElement('input');date.type='date';date.value=defaultDate();date.setAttribute('aria-label','绑定截止日期');
      actions.append(date,button('批准申请',async event=>{await act(event.currentTarget,()=>change(item,'approve',{expiresAt:expiryIso(date.value)},'申请已批准'),'申请已批准');}));
      actions.append(button('驳回',async event=>{
        await act(event.currentTarget,()=>change(item,'reject',{reason:'申请未通过'},'申请已驳回'),'申请已驳回');
      },'danger'));
    }
    if(item.status==='approved'){
      const date=document.createElement('input');date.type='date';date.value=item.expiresAt?.slice(0,10)||defaultDate();date.setAttribute('aria-label','新的截止日期');
      actions.append(date,button('修改期限',async event=>{await act(event.currentTarget,()=>change(item,'expiry',{expiresAt:expiryIso(date.value)},'期限已更新'),'期限已更新');}));
      actions.append(button('解绑',async event=>{await act(event.currentTarget,()=>change(item,'unbind',{},'设备已解绑'),'设备已解绑');}));
      const candidates=applications.filter(other=>other.status==='pending'&&other.phone===item.phone&&other.machineCode!==item.machineCode);
      if(candidates.length){
        const select=document.createElement('select');select.setAttribute('aria-label','换绑目标');
        for(const candidate of candidates){const option=document.createElement('option');option.value=candidate.id;option.textContent=`${candidate.machineCode} · ${dateText(candidate.createdAt)}`;select.append(option);}
        actions.append(select,button('换绑至新机器',async event=>{await act(event.currentTarget,()=>change(item,'rebind',{targetId:select.value},'已换绑到新机器'),'已换绑到新机器');}));
      }
    }
    actions.append(button('永久删除记录',async event=>{await act(event.currentTarget,()=>change(item,'delete',{},'记录已删除'),'记录已删除');},'danger'));
    row.append(top,pair,meta,actions);(item.status==='pending'?pending:bindings).append(row);
  }
}
async function loadApplications(){
  try{
    const items=[];let offset=0,total=0;
    do{const page=await window.licenseAdmin.applications({offset,limit:200});items.push(...page.items);total=page.total;offset=items.length;}while(offset<total);
    applications=items;renderApplications();message(`已同步 ${items.length} 条在线申请记录`);
  }catch(error){message(error.message,true);}
}
async function loadLegacy(){
  const host=$('legacyList');host.replaceChildren();
  try{const items=await window.licenseAdmin.legacyHistory();if(!items.length)host.append(el('p','暂无旧版记录','empty'));
    for(const item of items){const row=el('article','', 'binding-row');row.append(el('strong',item.name||'未命名用户'),el('code',`卡密 ${item.key} · 机器码 ${item.machineCode}`),el('small',`到期 ${dateText(item.expiresAt)}`));host.append(row);}}
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

$('reloadWallpapers').addEventListener('click',loadWallpapers);
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

window.licenseAdmin.status().then(state=>state.unlocked?showWorkspace():showAuth(state.needsSetup)).catch(error=>{document.getElementById('authPage').hidden=false;document.getElementById('authMessage').textContent=error.message;});
