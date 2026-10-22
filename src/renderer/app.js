const $ = id => document.getElementById(id);
const state = {view:'image',presetId:'auto',modelId:'gpt-image-2-vip',resolutionId:null,resolutionsByModel:{},references:[],imageModels:[],videoModels:[],presets:[],history:[],settings:null,activeSubmissions:0,lastSubmitAt:0,update:{state:'idle',version:null,percent:0},dismissedUpdateVersion:null,dismissedReadyVersion:null};
let toastTimer;
let sizeNoteRequest=0;
let workspaceBound=false;
let wallpaperOpacity=45;
const reducedWallpaperMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
function syncWallpaperPlayback(){
  const activation=$('activationWallpaperVideo');
  const workspace=$('workspaceWallpaperVideo');
  for(const [video,visible] of [[activation,!$('activationScreen').hidden],[workspace,!$('workspaceWallpaper').hidden&&wallpaperOpacity>0]]){
    if(!video.hidden&&visible&&!document.hidden&&!reducedWallpaperMotion.matches)video.play().catch(()=>{});
    else video.pause();
  }
}
function setWallpaperOpacity(value){
  const parsed=Number(value);
  wallpaperOpacity=Number.isFinite(parsed)?Math.max(0,Math.min(100,Math.round(parsed))):45;
  document.documentElement.style.setProperty('--workspace-wallpaper-opacity',String(wallpaperOpacity/100));
  $('wallpaperOpacity').value=String(wallpaperOpacity);
  $('wallpaperOpacityValue').value=`${wallpaperOpacity}%`;
  $('wallpaperButtonValue').textContent=`${wallpaperOpacity}%`;
  localStorage.setItem('workbench-wallpaper-opacity',String(wallpaperOpacity));
  syncWallpaperPlayback();
}
function applyWallpaper(wallpaper){
  if(!wallpaper)return;
  for(const prefix of ['activation','workspace']){
    const video=$(`${prefix}WallpaperVideo`);const image=$(`${prefix}WallpaperImage`);
    if(wallpaper.kind==='image'){
      image.src=wallpaper.url;image.hidden=false;video.hidden=true;video.pause();
    }else{
      image.hidden=true;image.removeAttribute('src');video.hidden=false;
      const source=$(`${prefix}WallpaperSource`);
      if(source.getAttribute('src')!==wallpaper.url){source.type=wallpaper.url.toLowerCase().endsWith('.webm')?'video/webm':'video/mp4';source.src=wallpaper.url;video.load();}
    }
  }
  syncWallpaperPlayback();
}
function renderModelSync(){
  if(!state.settings)return;
  const settings=state.settings;
  const provider=settings.provider==='grsai'?'Grsai':settings.provider==='geeknow'?'Geeknow':'自定义接口';
  $('settingsTitle').textContent='连接 '+provider+' API';
  const count=state.view==='image'?state.imageModels.length:state.videoModels.length;
  $('modelCount').textContent=(settings.syncedAt?'已同步 ':'当前 ')+count+' 个模型';
  $('modelSyncStatus').textContent=settings.supported===false?
    '此端口缺少可识别的模型或参数接口，需要适配；已保留之前的模型列表，生成暂不可用。':
    settings.syncedAt?'模型来源：'+settings.source+' · 上次同步 '+new Date(settings.syncedAt).toLocaleString('zh-CN')+
      (settings.unsupportedCount?' · '+settings.unsupportedCount+' 个模型参数待适配':''):
      '正在使用已知模型配置，点击“同步模型”刷新此端口的可用列表。';
  $('generateButton').disabled=settings.supported===false || currentModel()?.adapter==='unsupported';
}
function applyModelSnapshot(snapshot){
  state.settings=snapshot.settings;
  state.imageModels=snapshot.imageModels;
  state.videoModels=snapshot.videoModels;
  if(!currentModels().some(model=>model.id===state.modelId))state.modelId=currentModels()[0]?.id;
  renderConnection();renderModels();
}

function showActivation(license){
  document.querySelector('.app-shell').hidden=true;
  $('workspaceWallpaper').hidden=true;
  $('activationScreen').hidden=false;
  syncWallpaperPlayback();
  $('machineCodeValue').textContent=license.machineCode||'机器码读取失败';
  $('copyMachineCode').disabled=!license.machineCode;
  $('activationSubmit').disabled=!license.machineCode;
  const message=$('activationMessage');message.textContent=license.message||'填写用户名和密码提交申请';message.className='activation-message';
}
function showWorkspace(){ $('activationScreen').hidden=true;$('workspaceWallpaper').hidden=false;document.querySelector('.app-shell').hidden=false;syncWallpaperPlayback(); }
function bindActivation(){
  $('maintenanceContinue').addEventListener('click',async()=>{
    const button=$('maintenanceContinue');button.disabled=true;
    try{
      const init=await window.workbench.init();
      localStorage.setItem('workbench-maintenance-0.2.3','seen');
      $('maintenanceScreen').hidden=true;
      if(init.license.active)initializeWorkspace(init);else showActivation(init.license);
    }catch(error){$('maintenanceMessage').textContent=error.message;button.disabled=false;}
  });
  window.workbench.onWallpaper(applyWallpaper);
  $('copyMachineCode').addEventListener('click',async()=>{try{await window.workbench.copyMachineCode();$('activationMessage').textContent='机器码已复制';$('activationMessage').className='activation-message success';}catch(error){$('activationMessage').textContent=error.message;$('activationMessage').className='activation-message error';}});
  $('activationForm').addEventListener('submit',async event=>{
    event.preventDefault();const button=$('activationSubmit');const message=$('activationMessage');button.disabled=true;button.textContent='正在提交申请…';message.textContent='正在连接审批服务';message.className='activation-message';
    try{const status=await window.workbench.submitApplication({username:$('applicantUsername').value,password:$('applicantPassword').value});$('applicantPassword').value='';showActivation(status);}
    catch(error){message.textContent=(error.message||'激活失败').replace(/^Error invoking remote method '[^']+': Error: /,'');message.className='activation-message error';}
    finally{button.disabled=false;button.innerHTML='提交使用申请 <span>↗</span>';}
  });
  window.workbench.onLicense(async status=>{if(!status.active)showActivation(status);else if(!workspaceBound){const init=await window.workbench.init();initializeWorkspace(init);}else if(!$('activationScreen').hidden)showWorkspace();});
}
function initializeWorkspace(init){
  Object.assign(state,{settings:init.settings,imageModels:init.imageModels,videoModels:init.videoModels,presets:init.presets,history:init.history});
  $('versionLabel').textContent=`v${init.version}`;renderConnection();renderRatios();renderModels();renderHistory();
  if(!workspaceBound){bindEvents();workspaceBound=true;}
  showWorkspace();
}

function setTheme(theme){
  const chosen=theme==='dark'?'dark':'light';
  document.documentElement.dataset.theme=chosen;
  localStorage.setItem('workbench-theme',chosen);
  const button=$('themeToggle');
  button.textContent=chosen==='dark'?'☀ 浅色模式':'☾ 深色模式';
  button.setAttribute('aria-pressed',String(chosen==='dark'));
}
setTheme(localStorage.getItem('workbench-theme'));
setWallpaperOpacity(localStorage.getItem('workbench-wallpaper-opacity')??45);
document.addEventListener('visibilitychange',syncWallpaperPlayback);
reducedWallpaperMotion.addEventListener('change',syncWallpaperPlayback);

function renderUpdate(data){
  const previousVersion=state.update.version;
  state.update={...state.update,...data};
  if(data.version&&data.version!==previousVersion&&!('notes' in data))state.update.notes='';
  const status=state.update;
  const button=$('updateButton');
  const dialog=$('updateDialog');
  const action=$('updateActionButton');
  const title=$('updateTitle');
  const description=$('updateDescription');
  $('updateNotesText').textContent=status.notes||'此次更新说明暂未获取，请到 GitHub Releases 查看。';
  if(status.state==='current'){button.hidden=true;return;}
  if(status.state==='checking'||status.state==='idle')return;
  button.hidden=false;
  action.disabled=status.state==='downloading';
  if(status.state==='available'){
    button.textContent=`更新至 v${status.version}`;
    title.textContent=`发现新版本 v${status.version}`;
    description.textContent='新版本已发布。点击下载更新，或选择稍后再说；当前工作不会被打断。';
    action.textContent='下载更新';
    if(!dialog.open&&state.dismissedUpdateVersion!==status.version)dialog.showModal();
  }else if(status.state==='downloading'){
    button.textContent=`下载更新 ${status.percent||0}%`;
    title.textContent='正在下载更新';
    description.textContent=`下载进度 ${status.percent||0}%。你可以关闭此窗口并继续创作。`;
    action.textContent='下载中…';
  }else if(status.state==='ready'){
    button.textContent=`安装 v${status.version}`;
    title.textContent=`v${status.version} 已准备就绪`;
    description.textContent='点击“重启并安装”立即更新。你也可以稍后手动更新，关闭应用不会自动安装。';
    action.textContent='重启并安装';
    if(!dialog.open&&state.dismissedReadyVersion!==status.version)dialog.showModal();
  }else if(status.state==='error'){
    button.textContent='更新遇到问题';
    title.textContent='更新未完成';
    description.textContent=status.message||'请检查网络后重试。';
    action.textContent='重新检查';
  }
}

function toast(message) { const el=$('toast'); el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3800); }
function formatDate(value) { return new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}); }
function currentModels() { return state.view==='video'?state.videoModels:state.imageModels; }
function currentModel() { return currentModels().find(m=>m.id===state.modelId)||currentModels()[0]; }
const smoothSelects=new Map();
let openSmoothSelect=null;
function closeSmoothSelect(restoreFocus=false){
  if(!openSmoothSelect)return;
  const item=openSmoothSelect;openSmoothSelect=null;
  item.menu.classList.remove('is-open');item.trigger.setAttribute('aria-expanded','false');
  if(restoreFocus)item.trigger.focus();
}
function positionSmoothSelect(item){
  const rect=item.trigger.getBoundingClientRect();
  const below=innerHeight-rect.bottom-12;const above=rect.top-12;
  const up=below<210&&above>below;
  const height=Math.max(100,Math.min(320,up?above:below));
  item.menu.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-rect.width-8))}px`;
  item.menu.style.width=`${rect.width}px`;
  item.menu.style.maxHeight=`${height}px`;
  item.menu.style.top=up?'auto':`${rect.bottom+7}px`;
  item.menu.style.bottom=up?`${innerHeight-rect.top+7}px`:'auto';
  item.menu.style.transformOrigin=up?'bottom center':'top center';
}
function openSelect(item){
  if(openSmoothSelect===item){closeSmoothSelect();return;}
  closeSmoothSelect();openSmoothSelect=item;
  positionSmoothSelect(item);
  item.menu.classList.add('is-open');item.trigger.setAttribute('aria-expanded','true');
  const selected=item.menu.querySelector('[aria-selected="true"]')||item.menu.querySelector('.smooth-select-option');
  selected?.scrollIntoView({block:'nearest'});
}
function moveSmoothFocus(item,key){
  const options=Array.from(item.menu.querySelectorAll('.smooth-select-option'));
  if(!options.length)return;
  let index=options.indexOf(document.activeElement);
  if(index<0)index=options.findIndex(option=>option.getAttribute('aria-selected')==='true');
  if(key==='Home')index=0;else if(key==='End')index=options.length-1;
  else index=(index+(key==='ArrowUp'?-1:1)+options.length)%options.length;
  options[index].focus();options[index].scrollIntoView({block:'nearest'});
}
function syncSmoothSelect(id){
  const select=$(id);let item=smoothSelects.get(id);
  if(!item){
    const wrap=select.parentElement;wrap.classList.add('smooth-select-wrap');
    select.classList.add('smooth-select-native');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
    const trigger=document.createElement('button');trigger.type='button';trigger.className='smooth-select-trigger';trigger.setAttribute('role','combobox');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
    const label=document.createElement('span');label.className='smooth-select-label';const arrow=document.createElement('span');arrow.className='smooth-select-arrow';arrow.textContent='⌄';trigger.append(label,arrow);wrap.append(trigger);
    const menu=document.createElement('div');menu.id=`${id}Menu`;menu.className='smooth-select-menu';menu.setAttribute('role','listbox');menu.setAttribute('aria-label',select.getAttribute('aria-label')||'选择选项');document.body.append(menu);
    trigger.setAttribute('aria-controls',menu.id);
    item={select,trigger,label,menu};smoothSelects.set(id,item);
    trigger.addEventListener('click',()=>openSelect(item));
    trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();if(openSmoothSelect!==item)openSelect(item);moveSmoothFocus(item,event.key);}else if(event.key==='Escape'){closeSmoothSelect();}});
    menu.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();moveSmoothFocus(item,event.key);}else if(event.key==='Escape'||event.key==='Tab'){closeSmoothSelect(event.key==='Escape');}});
  }
  if(openSmoothSelect===item)closeSmoothSelect();
  item.menu.replaceChildren();
  const appendOption=option=>{
    const button=document.createElement('button');button.type='button';button.className='smooth-select-option';button.textContent=option.textContent;button.dataset.value=option.value;button.setAttribute('role','option');button.setAttribute('aria-selected',String(option.value===select.value));button.tabIndex=-1;button.disabled=option.disabled;
    button.addEventListener('click',()=>{select.value=option.value;closeSmoothSelect();select.dispatchEvent(new Event('change',{bubbles:true}));syncSmoothSelect(id);item.trigger.focus();});
    item.menu.append(button);
  };
  for(const child of select.children){
    if(child.tagName==='OPTGROUP'){
      const heading=document.createElement('div');heading.className='smooth-select-group';heading.textContent=child.label;item.menu.append(heading);
      for(const option of child.children)appendOption(option);
    }else if(child.tagName==='OPTION')appendOption(child);
  }
  const chosen=select.selectedOptions[0];
  item.label.textContent=chosen?.textContent||'请选择';
  item.trigger.setAttribute('aria-label',`${select.getAttribute('aria-label')||'选择选项'}：${item.label.textContent}`);
  item.trigger.disabled=select.disabled||!select.options.length;
}
document.addEventListener('click',event=>{if(openSmoothSelect&&!openSmoothSelect.trigger.contains(event.target)&&!openSmoothSelect.menu.contains(event.target))closeSmoothSelect();});
window.addEventListener('resize',()=>{if(openSmoothSelect)positionSmoothSelect(openSmoothSelect);});
document.addEventListener('scroll',()=>{if(openSmoothSelect)positionSmoothSelect(openSmoothSelect);},true);
function renderConnection() {
  const el=$('connectionPill');el.classList.toggle('connected',state.settings.hasKey);el.lastChild.textContent=state.settings.hasKey?` Key 已保存 ···${state.settings.keyTail}`:' 尚未设置 API';
  $('keyStoredNote').textContent=state.settings.hasKey?`已安全保存尾号 ···${state.settings.keyTail}；留空可保持原 Key`:'还未设置 API Key';
}
function renderModels() {
  const models=currentModels();const select=$('modelSelect');select.replaceChildren();
  for(const family of [...new Set(models.map(m=>m.family))]) {
    const group=document.createElement('optgroup');group.label=family;
    for(const model of models.filter(m=>m.family===family)){const option=document.createElement('option');option.value=model.id;option.textContent=model.label;group.append(option);}select.append(group);
  }
  if(!models.some(m=>m.id===state.modelId))state.modelId=models[0].id;
  select.value=state.modelId;
  syncSmoothSelect('modelSelect');
  const model=currentModel();$('modelName').textContent=model.label;$('modelFamily').textContent=model.family.toUpperCase();
  $('modelDesc').textContent=model.description|| (model.requiredRefs?'此模型必须上传参考图':model.refs?'支持文字与参考图创作':'仅支持文字提示词创作');
  $('referenceHint').textContent=model.requiredRefs?'必填 · 请添加参考图':model.refs?'可选 · 支持多图':'此模型不支持参考图';
  $('addReference').disabled=!model.refs;
  const seconds=$('secondsSelect');seconds.replaceChildren();
  if(state.view==='video')for(const n of model.seconds){const o=document.createElement('option');o.value=n;o.textContent=n;seconds.append(o);}
  $('secondsLabel').hidden=state.view!=='video';
  renderResolutions();
  updateSizeNote();
  renderModelSync();
}
function renderResolutions(){
  const section=$('resolutionSection');section.hidden=state.view!=='image';
  $('videoResolvedSize').hidden=state.view!=='video';
  if(state.view!=='image')return;
  const model=currentModel();const options=model.resolutions||['default'];
  const saved=state.resolutionsByModel[model.id];
  state.resolutionId=options.includes(saved)?saved:(model.defaultResolution||options[0]);
  state.resolutionsByModel[model.id]=state.resolutionId;
  const select=$('resolutionSelect');select.replaceChildren();
  for(const resolution of options){const option=document.createElement('option');option.value=resolution;option.textContent=resolution==='default'?'模型默认':resolution;select.append(option);}
  select.value=state.resolutionId;
  syncSmoothSelect('resolutionSelect');
}
function renderRatios() {
  const grid=$('ratioGrid');grid.replaceChildren();
  for(const preset of state.presets){
    const option=document.createElement('option');option.value=preset.id;
    option.textContent=preset.id==='auto'?'auto · 自动识别':preset.label;
    grid.append(option);
  }
  grid.value=state.presetId;
  syncSmoothSelect('ratioGrid');
}
function referenceDimensions(){return state.references[0]?{width:state.references[0].width,height:state.references[0].height}:null;}
async function updateSizeNote() {
  const model=currentModel();if(!model)return;
  const request=++sizeNoteRequest;const view=state.view;
  try{const result=await window.workbench.resolveSize({modelId:model.id,presetId:state.presetId,resolutionId:state.view==='image'?state.resolutionId:undefined,prompt:$('promptInput').value,referenceDimensions:referenceDimensions()});
    if(!result||request!==sizeNoteRequest)return;
    const label=result.size?`实际提交尺寸：${result.size} · 比例 ${result.ratio}`:`实际提交比例：${result.ratio}`;
    (view==='video'?$('videoResolvedSize'):$('resolvedSize')).textContent=label+(result.adjusted?'（已按模型能力适配）':'');
  }catch{}
}
function renderReferences(){const host=$('referenceList');host.replaceChildren();for(const r of state.references){const card=document.createElement('div');card.className='reference-card';const img=document.createElement('img');img.src=r.preview;img.alt=r.name;img.title='双击查看参考图';img.tabIndex=0;img.setAttribute('role','button');img.setAttribute('aria-label',`查看参考图：${r.name}`);img.addEventListener('dblclick',()=>showImagePreview(r.preview,r.name,'参考图'));img.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();showImagePreview(r.preview,r.name,'参考图');}});const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='移除参考图';remove.setAttribute('aria-label',`移除参考图：${r.name}`);remove.addEventListener('click',()=>{window.workbench.clearReferences([r.id]);state.references=state.references.filter(x=>x.id!==r.id);renderReferences();updateSizeNote();});card.append(img,remove);host.append(card);}}
async function appendReferences(found){for(const item of found){const img=new Image();img.src=item.preview;try{await img.decode();}catch{await window.workbench.clearReferences(found.map(ref=>ref.id));throw new Error(`${item.name} 无法作为图片打开`);}item.width=img.naturalWidth;item.height=img.naturalHeight;}state.references.push(...found);renderReferences();updateSizeNote();}
async function addDroppedReferences(fileList){const files=Array.from(fileList);if(!files.length)return;if(!currentModel().refs)throw new Error('当前模型不支持参考图');if(state.references.length+files.length>10)throw new Error('参考图最多支持 10 张，请先移除多余图片');const inputs=[];for(const file of files){if(!/\.(png|jpe?g|webp)$/i.test(file.name))throw new Error('参考图仅支持 PNG、JPG、WEBP 格式');if(!file.size||file.size>10*1024*1024)throw new Error(`${file.name} 必须小于 10 MB 且不能为空`);inputs.push({name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});}const found=await window.workbench.addReferences(inputs);await appendReferences(found);toast(`已添加 ${found.length} 张参考图`);}
function setView(view) {
  state.view=view;document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===view));
  const history=view==='history';$('creationView').hidden=history;$('historyView').hidden=!history;
  $('breadcrumbCurrent').textContent=view==='video'?'BRING IDEAS TO LIFE':'CREATE SOMETHING NEW';
  $('formTitle').textContent=view==='video'?'视频创作':'图像创作';
  $('actionHint').textContent=view==='video'?'准备就绪，开始创作你的视频':'准备就绪，开始创作你的图像';
  $('promptInput').placeholder=view==='video'?'描述场景、动作和镜头运动……':'描述你想创作的画面、风格与细节……';
  if(!history)renderModels();else renderHistory();
}
function statusLabel(record){return {submitting:'提交中',pending:Number(record.progress)>0?`生成中 ${Math.min(99,Math.round(Number(record.progress)))}%`:'生成中',complete:'已完成',failed:'生成失败',expired:'已过期'}[record.status]||record.status;}
function showImagePreview(src,alt,kind='生成图片'){const dialog=$('imagePreviewDialog');$('imagePreview').src=src;$('imagePreview').alt=alt||kind;$('imagePreviewTitle').textContent=`${kind} · ${alt||'图片预览'}`;if(!dialog.open)dialog.showModal();}
const GENERATED_IMAGE_DRAG='application/x-huajing-generated-image';
function mediaElement(record,index=0){if(record.status!=='complete'||!record.media?.[index])return null;const el=document.createElement(record.type==='video'?'video':'img');el.src=record.media[index];if(record.type==='video'){el.controls=true;el.preload='metadata';}else{el.alt=record.prompt;el.classList.add('zoomable-image','generated-image');el.title='双击放大 · 拖到参考图区域直接引用';el.draggable=true;el.addEventListener('dblclick',()=>showImagePreview(el.src,el.alt));el.addEventListener('dragstart',event=>{event.dataTransfer.setData(GENERATED_IMAGE_DRAG,JSON.stringify({id:record.id,index}));event.dataTransfer.effectAllowed='copy';if(state.view==='history')$('historyReferenceDrop').hidden=false;});el.addEventListener('dragend',()=>{$('historyReferenceDrop').hidden=true;$('historyReferenceDrop').classList.remove('drag-active');$('addReference').classList.remove('drag-active');});}return el;}
function appendRecordMedia(host,record){const count=record.type==='image'?record.media?.length||0:Math.min(record.media?.length||0,1);if(!count)return false;const gallery=document.createElement('div');gallery.className='record-media-gallery';if(count>1)gallery.classList.add('multiple');for(let i=0;i<count;i++)gallery.append(mediaElement(record,i));host.append(gallery);return true;}
function progressElement(record){if(!['submitting','pending','complete'].includes(record.status))return null;const progress=Number(record.progress);const known=record.status==='complete'||(record.status==='pending'&&Number.isFinite(progress)&&progress>0);const percent=record.status==='complete'?100:known?Math.min(99,Math.max(1,Math.round(progress))):0;const box=document.createElement('div');box.className=`task-progress${known?'':' task-progress-indeterminate'}${record.status==='complete'?' task-progress-complete':''}`;box.setAttribute('role','progressbar');box.setAttribute('aria-label',record.type==='video'?'视频生成进度':'图片生成进度');if(known)box.setAttribute('aria-valuenow',String(percent));box.setAttribute('aria-valuemin','0');box.setAttribute('aria-valuemax','100');const label=document.createElement('div');label.className='task-progress-label';label.innerHTML=`<span>${record.status==='complete'?'生成完成':record.status==='submitting'?'正在提交':'正在生成'}</span><span>${known?`${percent}%`:'处理中'}</span>`;const track=document.createElement('div');track.className='task-progress-track';const fill=document.createElement('span');fill.className='task-progress-fill';if(known)fill.style.width=`${percent}%`;track.append(fill);box.append(label,track);return box;}
function recordActionIcon(kind){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
  svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');
  svg.setAttribute('stroke-width','1.8');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
  const path=document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d',kind==='copy'?'M8 7h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm8 0V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1':'M4 11V7a3 3 0 0 1 3-3h3v5H7v2a3 3 0 0 1-3 3Zm10 0V7a3 3 0 0 1 3-3h3v5h-3v2a3 3 0 0 1-3 3Z');
  svg.append(path);return svg;
}
function recordButton(label,kind,action){
  const button=document.createElement('button');button.type='button';button.className='record-action-button';
  button.title=kind==='quote'?'引用提示词并恢复创作参数':'复制这条任务的提示词';
  button.setAttribute('aria-label',button.title);
  button.append(recordActionIcon(kind),document.createTextNode(label));
  button.addEventListener('click',async()=>{button.disabled=true;try{await action();}catch(error){toast(error.message||'操作失败');}finally{button.disabled=false;}});
  return button;
}
function recordActions(record,saveLabel){
  const actions=document.createElement('div');actions.className='record-actions';
  if(record.status==='complete')record.media?.forEach((_,i)=>{
    const button=document.createElement('button');button.type='button';button.textContent=record.media.length>1?`${saveLabel} ${i+1}`:saveLabel;
    button.addEventListener('click',()=>saveMedia(record,i));actions.append(button);
  });
  if(record.prompt){
    const end=document.createElement('div');end.className='record-actions-end';
    end.append(recordButton('引用','quote',()=>quoteRecord(record)),recordButton('复制','copy',async()=>{await window.workbench.copyPrompt(record.id);toast('已复制该任务的提示词');}));
    actions.append(end);
  }
  return actions;
}
async function quoteRecord(record){
  const prompt=String(record.prompt||'');
  if(!prompt.trim())throw new Error('这条任务没有可引用的提示词');
  $('promptInput').value=prompt;
  $('promptCount').textContent=`${prompt.length} / 8000`;
  if(record.baseUrl&&record.baseUrl!==state.settings.baseUrl){
    const snapshot=await window.workbench.saveSettings({baseUrl:record.baseUrl});
    applyModelSnapshot(snapshot);
  }
  const type=record.type==='video'?'video':'image';
  const available=type==='video'?state.videoModels:state.imageModels;
  if(!available.length){toast('已引用提示词；原接口没有可用模型，请检查 API 设置');return;}
  setView(type);
  const model=currentModels().find(item=>item.id===record.modelId);
  if(model){
    state.modelId=model.id;
    const selection=resolveRecordParams(record,model,state.presets);
    state.presetId=selection.ratio;
    if(type==='image')state.resolutionsByModel[model.id]=selection.resolution;
    renderModels();renderRatios();
    if(type==='video'&&selection.seconds)$('secondsSelect').value=selection.seconds;
    toast('已引用提示词和创作参数');
  }else toast('已引用提示词；原模型在当前接口不可用，请检查 API 设置');
  updateSizeNote();
  $('promptInput').scrollIntoView({behavior:'smooth',block:'center'});
  $('promptInput').focus({preventScroll:true});
}
function renderRecentCard(record){
  const card=document.createElement('article');card.className='recent-card';
  const thumb=document.createElement('div');thumb.className='recent-thumb';
  if(!appendRecordMedia(thumb,record)){const placeholder=document.createElement('span');placeholder.className='thumb-placeholder';placeholder.textContent=record.type==='video'?'▶':'✦';thumb.append(placeholder);}
  const status=document.createElement('span');status.className='recent-status';status.textContent=statusLabel(record);thumb.append(status);
  const meta=document.createElement('div');meta.className='recent-meta';
  const title=document.createElement('strong');title.textContent=record.prompt;
  const small=document.createElement('small');small.textContent=`${record.modelName} · ${formatDate(record.createdAt)}`;meta.append(title,small);
  const progress=progressElement(record);if(progress)meta.append(progress);
  if(record.status==='failed'){const error=document.createElement('small');error.textContent=record.error||record.lastPollError||'请求失败';meta.append(error);}
  if(record.status==='expired'){const expired=document.createElement('small');expired.textContent='临时文件已自动清理';meta.append(expired);}
  if(record.prompt||record.status==='complete')meta.append(recordActions(record,'保存作品'));
  card.append(thumb,meta);return card;
}
function renderHistory(){
  const recent=$('recentList');const full=$('historyFullList');$('clearHistoryButton').disabled=!state.history.length;
  recent.replaceChildren();full.replaceChildren();
  if(!state.history.length){const empty=document.createElement('div');empty.className='empty-history';const symbol=document.createElement('span');symbol.textContent='✦';empty.append(symbol,document.createTextNode('还没有作品\n开始第一次创作吧'));recent.append(empty);full.append(empty.cloneNode(true));return;}
  state.history.slice(0,8).forEach(record=>recent.append(renderRecentCard(record)));
  for(const record of state.history){
    const card=document.createElement('article');card.className='history-card';
    const preview=document.createElement('div');preview.className='history-preview';
    if(!appendRecordMedia(preview,record)){const placeholder=document.createElement('span');placeholder.className='thumb-placeholder';placeholder.textContent=record.status==='expired'?'◷':record.type==='video'?'▶':'✦';preview.append(placeholder);}
    const body=document.createElement('div');body.className='history-copy';
    const title=document.createElement('h3');title.textContent=record.modelName;
    const prompt=document.createElement('p');prompt.textContent=record.prompt;
    const small=document.createElement('small');small.textContent=`${formatDate(record.createdAt)} · ${statusLabel(record)}${record.actualSize?' · '+record.actualSize:''}`;
    body.append(title,prompt,small);
    const progress=progressElement(record);if(progress)body.append(progress);
    if(record.status==='failed'){const error=document.createElement('p');error.textContent=record.error||record.lastPollError||'';body.append(error);}
    if(record.prompt||record.status==='complete')body.append(recordActions(record,'保存作品'));
    card.append(preview,body);full.append(card);
  }
}
async function saveMedia(record,index){try{const done=await window.workbench.saveResult(record.id,index);if(done)toast('作品已永久保存到所选位置');}catch(e){toast(e.message);}}
async function doGenerate(){if(!state.settings.hasKey){$('settingsDialog').showModal();toast('请先设置 API Key');return;}const model=currentModel();const prompt=$('promptInput').value.trim();if(!prompt){toast('请先填写提示词');$('promptInput').focus();return;}if(model.requiredRefs&&!state.references.length){toast('该模型需要参考图');return;}if(state.references.length&&!model.refs){toast('该模型不支持参考图');return;}
  if(Date.now()-state.lastSubmitAt<600)return;
  state.lastSubmitAt=Date.now();
  const input={type:state.view,modelId:model.id,prompt,presetId:state.presetId,resolutionId:state.view==='image'?state.resolutionId:undefined,referenceIds:state.references.map(r=>r.id),referenceDimensions:referenceDimensions(),seconds:Number($('secondsSelect').value)};
  state.activeSubmissions++;$('generateButton').innerHTML=`<span>✦</span> 继续生成 · ${state.activeSubmissions} 个提交中 <span class="button-arrow">↗</span>`;
  try{const result=await window.workbench.generate(input);toast(result.status==='cleared'?'任务已从历史中清除':result.status==='complete'?'生成完成，请及时保存作品':'任务已提交，可继续创建其他任务');state.history=await window.workbench.history();renderHistory();}
  catch(e){toast((e.message||'生成失败').replace(/^Error invoking remote method '[^']+': Error: /,''));state.history=await window.workbench.history();renderHistory();}
  finally{state.activeSubmissions--;const count=state.activeSubmissions;$('generateButton').innerHTML=`<span>✦</span> ${count?`继续生成 · ${count} 个提交中`:'立即生成'} <span class="button-arrow">↗</span>`;}
}
function bindEvents(){document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));$('allHistoryButton').addEventListener('click',()=>setView('history'));
  $('expandPromptButton').addEventListener('click',()=>{const wrap=document.querySelector('.prompt-input-wrap');const expanded=wrap.classList.toggle('expanded');const button=$('expandPromptButton');button.setAttribute('aria-expanded',String(expanded));button.setAttribute('aria-label',expanded?'收起提示词输入框':'展开提示词输入框');button.title=expanded?'收起提示词输入框':'展开提示词输入框';button.textContent=expanded?'⤡':'⤢';$('promptInput').focus();if(expanded)requestAnimationFrame(()=>$('promptInput').scrollIntoView({block:'center',behavior:'smooth'}));});
  $('closeImagePreview').addEventListener('click',()=>$('imagePreviewDialog').close());
  $('imagePreviewDialog').addEventListener('click',event=>{if(event.target===$('imagePreviewDialog'))$('imagePreviewDialog').close();});
  $('imagePreviewDialog').addEventListener('close',()=>{$('imagePreview').removeAttribute('src');});
  $('clearHistoryButton').addEventListener('click',async()=>{try{const result=await window.workbench.clearHistory();if(result.cleared){state.history=[];renderHistory();toast(`已清空 ${result.count} 条历史任务`);}}catch(error){toast(error.message);}});
  $('themeToggle').addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
  $('wallpaperToggle').addEventListener('click',()=>{const panel=$('wallpaperPopover');panel.hidden=!panel.hidden;$('wallpaperToggle').setAttribute('aria-expanded',String(!panel.hidden));});
  $('wallpaperOpacity').addEventListener('input',event=>setWallpaperOpacity(event.target.value));
  document.addEventListener('click',event=>{if(!event.target.closest('.wallpaper-control')){$('wallpaperPopover').hidden=true;$('wallpaperToggle').setAttribute('aria-expanded','false');}});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'){$('wallpaperPopover').hidden=true;$('wallpaperToggle').setAttribute('aria-expanded','false');}});
  $('updateButton').addEventListener('click',()=>$('updateDialog').showModal());
  $('closeUpdateDialog').addEventListener('click',()=>$('updateDialog').close());
  $('updateLaterButton').addEventListener('click',()=>$('updateDialog').close());
  $('updateDialog').addEventListener('close',()=>{if(state.update.state==='available')state.dismissedUpdateVersion=state.update.version;if(state.update.state==='ready')state.dismissedReadyVersion=state.update.version;});
  $('updateActionButton').addEventListener('click',async()=>{const status=state.update.state;try{if(status==='available'){renderUpdate({state:'downloading',percent:0});await window.workbench.downloadUpdate();}else if(status==='ready')await window.workbench.installUpdate();else if(status==='error')await window.workbench.checkUpdates();}catch(error){renderUpdate({state:'error',message:error.message});toast(error.message);}});
  window.workbench.onNotice(toast);
  window.workbench.onReferencesExpired(ids=>{state.references=state.references.filter(reference=>!ids.includes(reference.id));renderReferences();updateSizeNote();toast('已生成图片超过两小时，相关参考图已移除');});
  $('promptInput').addEventListener('input',()=>{$('promptCount').textContent=`${$('promptInput').value.length} / 8000`;updateSizeNote();});$('modelSelect').addEventListener('change',e=>{state.modelId=e.target.value;renderModels();});
  $('ratioGrid').addEventListener('change',e=>{state.presetId=e.target.value;updateSizeNote();});
  $('resolutionSelect').addEventListener('change',e=>{state.resolutionId=e.target.value;state.resolutionsByModel[currentModel().id]=e.target.value;updateSizeNote();});
  $('addReference').addEventListener('click',async()=>{try{await appendReferences(await window.workbench.chooseReferences());}catch(e){toast(e.message);}});
  const dropzone=$('addReference');
  const historyDrop=$('historyReferenceDrop');
  const hasGeneratedImage=event=>Array.from(event.dataTransfer?.types||[]).includes(GENERATED_IMAGE_DRAG);
  async function addDraggedGeneratedImage(event){
    const payload=JSON.parse(event.dataTransfer.getData(GENERATED_IMAGE_DRAG));
    if(!payload || typeof payload.id!=='string' || !Number.isInteger(payload.index))throw new Error('无法识别拖入的生成图片');
    if(state.view==='history')setView('image');
    if(!currentModel()?.refs)throw new Error('当前模型不支持参考图，请先切换支持参考图的模型');
    const found=await window.workbench.addGeneratedReference(payload.id,payload.index);
    await appendReferences(found);
    toast('已将生成图片添加为参考图');
  }
  for(const target of [dropzone,historyDrop]){
    target.addEventListener('dragover',event=>{if(!hasGeneratedImage(event))return;event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';target.classList.add('drag-active');});
    target.addEventListener('dragleave',event=>{if(!target.contains(event.relatedTarget))target.classList.remove('drag-active');});
    target.addEventListener('drop',async event=>{if(!hasGeneratedImage(event))return;event.preventDefault();event.stopPropagation();target.classList.remove('drag-active');historyDrop.hidden=true;try{await addDraggedGeneratedImage(event);}catch(error){toast(error.message||'添加参考图失败');}});
  }
  document.addEventListener('dragover',event=>{if(!hasGeneratedImage(event))return;event.preventDefault();event.dataTransfer.dropEffect='none';});
  document.addEventListener('drop',event=>{if(hasGeneratedImage(event)){event.preventDefault();historyDrop.hidden=true;}});
  const hasDraggedFiles=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
  document.addEventListener('dragover',event=>{if(hasGeneratedImage(event)||!hasDraggedFiles(event))return;event.preventDefault();const allowed=!$('creationView').hidden&&currentModel()?.refs&&!$('settingsDialog').open&&!$('updateDialog').open&&!$('imagePreviewDialog').open;event.dataTransfer.dropEffect=allowed?'copy':'none';dropzone.classList.toggle('drag-active',!!allowed);});
  document.addEventListener('dragleave',event=>{if(!event.relatedTarget)dropzone.classList.remove('drag-active');});
  document.addEventListener('drop',async event=>{if(hasGeneratedImage(event)||!hasDraggedFiles(event))return;event.preventDefault();dropzone.classList.remove('drag-active');if($('creationView').hidden||$('settingsDialog').open||$('updateDialog').open||$('imagePreviewDialog').open)return;try{await addDroppedReferences(event.dataTransfer.files);}catch(error){toast(error.message);}});
  $('generateButton').addEventListener('click',doGenerate);$('settingsButton').addEventListener('click',()=>{$('apiKeyInput').value='';$('baseUrlInput').value=state.settings.baseUrl;renderConnection();$('settingsDialog').showModal();});
  $('baseUrlInput').addEventListener('input',()=>{$('keyStoredNote').textContent='切换端口时请输入该站点的 API Key；已保存过的端口会自动恢复自己的 Key。';});
  $('closeSettingsDialog').addEventListener('click',()=>$('settingsDialog').close());
  $('toggleKey').addEventListener('click',()=>{const input=$('apiKeyInput');input.type=input.type==='password'?'text':'password';$('toggleKey').textContent=input.type==='password'?'显示':'隐藏';});
  $('settingsForm').addEventListener('submit',async e=>{e.preventDefault();try{const result=await window.workbench.saveSettings({baseUrl:$('baseUrlInput').value,apiKey:$('apiKeyInput').value});applyModelSnapshot(result);$('settingsDialog').close();toast(result.syncError?'设置已保存；模型同步失败：'+result.syncError:'API 设置已保存，模型已同步');}catch(err){toast(err.message);}});
  $('verifyKeyButton').addEventListener('click',async()=>{const b=$('verifyKeyButton');b.disabled=true;b.textContent='测试中…';try{const result=await window.workbench.verifySettings({baseUrl:$('baseUrlInput').value,apiKey:$('apiKeyInput').value});toast(result.authVerified?'连接成功，当前 Key 可读取 '+result.modelCount+' 个生图模型':'已读取 '+result.modelCount+' 个公开模型；此站点需在首次生成时验证 Key 权限');}catch(e){toast('连接失败：'+e.message);}finally{b.disabled=false;b.textContent='测试连接';}});
  $('clearKeyButton').addEventListener('click',async()=>{try{applyModelSnapshot(await window.workbench.saveSettings({baseUrl:$('baseUrlInput').value,clearKey:true}));$('apiKeyInput').value='';toast('已清除当前端口保存的 API Key');}catch(e){toast(e.message);}});
  $('syncModelsButton').addEventListener('click',async()=>{const button=$('syncModelsButton');button.disabled=true;button.textContent='同步中…';try{const result=await window.workbench.syncModels();applyModelSnapshot(result);toast('已同步 '+result.imageModels.length+' 个生图模型'+(result.unsupportedCount?'；'+result.unsupportedCount+' 个需要适配':''));}catch(error){toast('同步失败：'+error.message);}finally{button.disabled=false;button.textContent='同步模型 ↻';}});
  window.workbench.onModels(snapshot=>{applyModelSnapshot(snapshot);});
  window.workbench.onModelSyncError(error=>toast('自动同步模型失败：'+error));
  window.workbench.onHistory(data=>{state.history=data;renderHistory();});window.workbench.onUpdate(data=>{renderUpdate(data);if(data.state==='ready')toast(`新版本 ${data.version} 已下载，可选择重启安装`);});
}
async function boot(){bindActivation();try{const init=await window.workbench.init();applyWallpaper(init.wallpaper);$('activationVersion').textContent=`画境工作台 v${init.version}`;if(localStorage.getItem('workbench-maintenance-0.2.3')!=='seen'){$('activationScreen').hidden=true;$('maintenanceScreen').hidden=false;syncWallpaperPlayback();return;}if(init.license.active)initializeWorkspace(init);else showActivation(init.license);}catch(e){$('activationMessage').textContent=`启动失败：${e.message}`;$('activationMessage').className='activation-message error';}}
boot();
