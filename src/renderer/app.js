const $ = id => document.getElementById(id);
const state = {view:'image',presetId:'auto',modelId:'gpt-image-2-vip',resolutionId:null,resolutionsByModel:{},references:[],imageModels:[],videoModels:[],presets:[],history:[],settings:null,activeSubmissions:0,lastSubmitAt:0,update:{state:'idle',version:null,percent:0},dismissedUpdateVersion:null,dismissedReadyVersion:null};
let toastTimer;
let sizeNoteRequest=0;
let workspaceBound=false;
function applyWallpaper(wallpaper){
  if(!wallpaper)return;
  const video=$('activationWallpaperVideo');const image=$('activationWallpaperImage');
  if(wallpaper.kind==='image'){
    image.src=wallpaper.url;image.hidden=false;video.hidden=true;video.pause();
  }else{
    image.hidden=true;image.removeAttribute('src');video.hidden=false;
    const source=$('activationWallpaperSource');
    if(source.getAttribute('src')!==wallpaper.url){source.type=wallpaper.url.toLowerCase().endsWith('.webm')?'video/webm':'video/mp4';source.src=wallpaper.url;video.load();}
    video.play().catch(()=>{});
  }
}
function renderModelSync(){
  if(!state.settings)return;
  const settings=state.settings;
  const provider=settings.provider==='grsai'?'Grsai':settings.provider==='geeknow'?'Geeknow':'?????';
  $('settingsTitle').textContent='?? '+provider+' API';
  const count=state.view==='image'?state.imageModels.length:state.videoModels.length;
  $('modelCount').textContent=(settings.syncedAt?'??? ':'?? ')+count+' ???';
  $('modelSyncStatus').textContent=settings.supported===false?
    '????????????????????????????????????????':
    settings.syncedAt?'?????'+settings.source+' ? ???? '+new Date(settings.syncedAt).toLocaleString('zh-CN')+
      (settings.unsupportedCount?' ? '+settings.unsupportedCount+' ????????':''):
      '??????????????????????????????';
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
  $('activationScreen').hidden=false;
  if(!$('activationWallpaperVideo').hidden)$('activationWallpaperVideo').play().catch(()=>{});
  $('machineCodeValue').textContent=license.machineCode||'???????';
  $('copyMachineCode').disabled=!license.machineCode;
  $('activationSubmit').disabled=!license.machineCode;
  const message=$('activationMessage');message.textContent=license.message||'????????????';message.className='activation-message';
}
function showWorkspace(){ $('activationScreen').hidden=true;$('activationWallpaperVideo').pause();document.querySelector('.app-shell').hidden=false; }
function bindActivation(){
  window.workbench.onWallpaper(applyWallpaper);
  $('copyMachineCode').addEventListener('click',async()=>{try{await window.workbench.copyMachineCode();$('activationMessage').textContent='??????';$('activationMessage').className='activation-message success';}catch(error){$('activationMessage').textContent=error.message;$('activationMessage').className='activation-message error';}});
  $('activationForm').addEventListener('submit',async event=>{
    event.preventDefault();const button=$('activationSubmit');const message=$('activationMessage');button.disabled=true;button.textContent='???????';message.textContent='????????';message.className='activation-message';
    try{const status=await window.workbench.submitApplication({name:$('applicantName').value,phone:$('applicantPhone').value});showActivation(status);}
    catch(error){message.textContent=(error.message||'????').replace(/^Error invoking remote method '[^']+': Error: /,'');message.className='activation-message error';}
    finally{button.disabled=false;button.innerHTML='?????? <span>?</span>';}
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
  button.textContent=chosen==='dark'?'? ????':'? ????';
  button.setAttribute('aria-pressed',String(chosen==='dark'));
}
setTheme(localStorage.getItem('workbench-theme'));

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
  $('updateNotesText').textContent=status.notes||'????????????? GitHub Releases ???';
  if(status.state==='current'){button.hidden=true;return;}
  if(status.state==='checking'||status.state==='idle')return;
  button.hidden=false;
  action.disabled=status.state==='downloading';
  if(status.state==='available'){
    button.textContent=`??? v${status.version}`;
    title.textContent=`????? v${status.version}`;
    description.textContent='????????????????????????????????';
    action.textContent='????';
    if(!dialog.open&&state.dismissedUpdateVersion!==status.version)dialog.showModal();
  }else if(status.state==='downloading'){
    button.textContent=`???? ${status.percent||0}%`;
    title.textContent='??????';
    description.textContent=`???? ${status.percent||0}%???????????????`;
    action.textContent='????';
  }else if(status.state==='ready'){
    button.textContent=`?? v${status.version}`;
    title.textContent=`v${status.version} ?????`;
    description.textContent='????????????????????????????????????';
    action.textContent='?????';
    if(!dialog.open&&state.dismissedReadyVersion!==status.version)dialog.showModal();
  }else if(status.state==='error'){
    button.textContent='??????';
    title.textContent='?????';
    description.textContent=status.message||'?????????';
    action.textContent='????';
  }
}

function toast(message) { const el=$('toast'); el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3800); }
function formatDate(value) { return new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}); }
function currentModels() { return state.view==='video'?state.videoModels:state.imageModels; }
function currentModel() { return currentModels().find(m=>m.id===state.modelId)||currentModels()[0]; }
function renderConnection() {
  const el=$('connectionPill');el.classList.toggle('connected',state.settings.hasKey);el.lastChild.textContent=state.settings.hasKey?` Key ??? ???${state.settings.keyTail}`:' ???? API';
  $('keyStoredNote').textContent=state.settings.hasKey?`??????? ???${state.settings.keyTail}??????? Key`:'???? API Key';
}
function renderModels() {
  const models=currentModels();const select=$('modelSelect');select.replaceChildren();
  for(const family of [...new Set(models.map(m=>m.family))]) {
    const group=document.createElement('optgroup');group.label=family;
    for(const model of models.filter(m=>m.family===family)){const option=document.createElement('option');option.value=model.id;option.textContent=model.label;group.append(option);}select.append(group);
  }
  if(!models.some(m=>m.id===state.modelId))state.modelId=models[0].id;
  select.value=state.modelId;
  const model=currentModel();$('modelName').textContent=model.label;$('modelFamily').textContent=model.family.toUpperCase();
  $('modelDesc').textContent=model.description|| (model.requiredRefs?'??????????':model.refs?'??????????':'??????????');
  $('referenceHint').textContent=model.requiredRefs?'?? ? ??????':model.refs?'?? ? ????':'?????????';
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
  for(const resolution of options){const option=document.createElement('option');option.value=resolution;option.textContent=resolution==='default'?'????':resolution;select.append(option);}
  select.value=state.resolutionId;
}
function renderRatios() {
  const grid=$('ratioGrid');grid.replaceChildren();
  for(const preset of state.presets){
    const option=document.createElement('option');option.value=preset.id;
    option.textContent=preset.id==='auto'?'auto ? ????':preset.label;
    grid.append(option);
  }
  grid.value=state.presetId;
}
function referenceDimensions(){return state.references[0]?{width:state.references[0].width,height:state.references[0].height}:null;}
async function updateSizeNote() {
  const model=currentModel();if(!model)return;
  const request=++sizeNoteRequest;const view=state.view;
  try{const result=await window.workbench.resolveSize({modelId:model.id,presetId:state.presetId,resolutionId:state.view==='image'?state.resolutionId:undefined,prompt:$('promptInput').value,referenceDimensions:referenceDimensions()});
    if(!result||request!==sizeNoteRequest)return;
    const label=result.size?`???????${result.size} ? ?? ${result.ratio}`:`???????${result.ratio}`;
    (view==='video'?$('videoResolvedSize'):$('resolvedSize')).textContent=label+(result.adjusted?'??????????':'');
  }catch{}
}
function renderReferences(){const host=$('referenceList');host.replaceChildren();for(const r of state.references){const card=document.createElement('div');card.className='reference-card';const img=document.createElement('img');img.src=r.preview;img.alt=r.name;img.title='???????';img.tabIndex=0;img.setAttribute('role','button');img.setAttribute('aria-label',`??????${r.name}`);img.addEventListener('dblclick',()=>showImagePreview(r.preview,r.name,'???'));img.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();showImagePreview(r.preview,r.name,'???');}});const remove=document.createElement('button');remove.type='button';remove.textContent='?';remove.title='?????';remove.setAttribute('aria-label',`??????${r.name}`);remove.addEventListener('click',()=>{window.workbench.clearReferences([r.id]);state.references=state.references.filter(x=>x.id!==r.id);renderReferences();updateSizeNote();});card.append(img,remove);host.append(card);}}
async function appendReferences(found){for(const item of found){const img=new Image();img.src=item.preview;try{await img.decode();}catch{await window.workbench.clearReferences(found.map(ref=>ref.id));throw new Error(`${item.name} ????????`);}item.width=img.naturalWidth;item.height=img.naturalHeight;}state.references.push(...found);renderReferences();updateSizeNote();}
async function addDroppedReferences(fileList){const files=Array.from(fileList);if(!files.length)return;if(!currentModel().refs)throw new Error('??????????');if(state.references.length+files.length>10)throw new Error('??????? 10 ??????????');const inputs=[];for(const file of files){if(!/\.(png|jpe?g|webp)$/i.test(file.name))throw new Error('?????? PNG?JPG?WEBP ??');if(!file.size||file.size>10*1024*1024)throw new Error(`${file.name} ???? 10 MB ?????`);inputs.push({name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});}const found=await window.workbench.addReferences(inputs);await appendReferences(found);toast(`??? ${found.length} ????`);}
function setView(view) {
  state.view=view;document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===view));
  const history=view==='history';$('creationView').hidden=history;$('historyView').hidden=!history;
  $('breadcrumbCurrent').textContent=view==='video'?'BRING IDEAS TO LIFE':'CREATE SOMETHING NEW';
  $('formTitle').textContent=view==='video'?'????':'????';
  $('actionHint').textContent=view==='video'?'?????????????':'?????????????';
  $('promptInput').placeholder=view==='video'?'??????????????':'?????????????????';
  if(!history)renderModels();else renderHistory();
}
function statusLabel(record){return {submitting:'???',pending:Number(record.progress)>0?`??? ${Math.min(99,Math.round(Number(record.progress)))}%`:'???',complete:'???',failed:'????',expired:'???'}[record.status]||record.status;}
function showImagePreview(src,alt,kind='????'){const dialog=$('imagePreviewDialog');$('imagePreview').src=src;$('imagePreview').alt=alt||kind;$('imagePreviewTitle').textContent=`${kind} ? ${alt||'????'}`;if(!dialog.open)dialog.showModal();}
function mediaElement(record,index=0){if(record.status!=='complete'||!record.media?.[index])return null;const el=document.createElement(record.type==='video'?'video':'img');el.src=record.media[index];if(record.type==='video'){el.controls=true;el.preload='metadata';}else{el.alt=record.prompt;el.classList.add('zoomable-image');el.title='??????';el.addEventListener('dblclick',()=>showImagePreview(el.src,el.alt));}return el;}
function progressElement(record){if(!['submitting','pending','complete'].includes(record.status))return null;const progress=Number(record.progress);const known=record.status==='complete'||(record.status==='pending'&&Number.isFinite(progress)&&progress>0);const percent=record.status==='complete'?100:known?Math.min(99,Math.max(1,Math.round(progress))):0;const box=document.createElement('div');box.className=`task-progress${known?'':' task-progress-indeterminate'}${record.status==='complete'?' task-progress-complete':''}`;box.setAttribute('role','progressbar');box.setAttribute('aria-label',record.type==='video'?'??????':'??????');if(known)box.setAttribute('aria-valuenow',String(percent));box.setAttribute('aria-valuemin','0');box.setAttribute('aria-valuemax','100');const label=document.createElement('div');label.className='task-progress-label';label.innerHTML=`<span>${record.status==='complete'?'????':record.status==='submitting'?'????':'????'}</span><span>${known?`${percent}%`:'???'}</span>`;const track=document.createElement('div');track.className='task-progress-track';const fill=document.createElement('span');fill.className='task-progress-fill';if(known)fill.style.width=`${percent}%`;track.append(fill);box.append(label,track);return box;}
function renderRecentCard(record){const card=document.createElement('article');card.className='recent-card';const thumb=document.createElement('div');thumb.className='recent-thumb';const media=mediaElement(record);if(media)thumb.append(media);else{const p=document.createElement('span');p.className='thumb-placeholder';p.textContent=record.type==='video'?'?':'?';thumb.append(p);}const status=document.createElement('span');status.className='recent-status';status.textContent=statusLabel(record);thumb.append(status);
  const meta=document.createElement('div');meta.className='recent-meta';const title=document.createElement('strong');title.textContent=record.prompt;const small=document.createElement('small');small.textContent=`${record.modelName} ? ${formatDate(record.createdAt)}`;meta.append(title,small);
  const progress=progressElement(record);if(progress)meta.append(progress);
  if(record.status==='complete'){const actions=document.createElement('div');actions.className='recent-actions';record.media.forEach((_,i)=>{const b=document.createElement('button');b.textContent=record.media.length>1?`??? ${i+1} ?`:'????';b.addEventListener('click',()=>saveMedia(record,i));actions.append(b);});meta.append(actions);}else if(record.status==='failed'){const error=document.createElement('small');error.textContent=record.error||record.lastPollError||'????';meta.append(error);}else if(record.status==='expired'){const expired=document.createElement('small');expired.textContent='?????????';meta.append(expired);}card.append(thumb,meta);return card;}
function renderHistory(){const recent=$('recentList');const full=$('historyFullList');$('clearHistoryButton').disabled=!state.history.length;recent.replaceChildren();full.replaceChildren();if(!state.history.length){const empty=document.createElement('div');empty.className='empty-history';const s=document.createElement('span');s.textContent='?';empty.append(s,document.createTextNode('?????\n????????'));recent.append(empty);const clone=empty.cloneNode(true);full.append(clone);return;}
  state.history.slice(0,8).forEach(r=>recent.append(renderRecentCard(r)));
  for(const r of state.history){const card=document.createElement('article');card.className='history-card';const preview=document.createElement('div');preview.className='history-preview';const media=mediaElement(r);if(media)preview.append(media);else{const p=document.createElement('span');p.className='thumb-placeholder';p.textContent=r.status==='expired'?'?':r.type==='video'?'?':'?';preview.append(p);}const copy=document.createElement('div');copy.className='history-copy';const h=document.createElement('h3');h.textContent=r.modelName;const p=document.createElement('p');p.textContent=r.prompt;const small=document.createElement('small');small.textContent=`${formatDate(r.createdAt)} ? ${statusLabel(r)}${r.actualSize?' ? '+r.actualSize:''}`;copy.append(h,p,small);const progress=progressElement(r);if(progress)copy.append(progress);if(r.status==='complete'){r.media.forEach((_,i)=>{const b=document.createElement('button');b.textContent=r.media.length>1?`?? ${i+1}`:'????';b.addEventListener('click',()=>saveMedia(r,i));copy.append(b);});}if(r.status==='failed'){const err=document.createElement('p');err.textContent=r.error||r.lastPollError||'';copy.append(err);}card.append(preview,copy);full.append(card);}
}
async function saveMedia(record,index){try{const done=await window.workbench.saveResult(record.id,index);if(done)toast('????????????');}catch(e){toast(e.message);}}
async function doGenerate(){if(!state.settings.hasKey){$('settingsDialog').showModal();toast('???? API Key');return;}const model=currentModel();const prompt=$('promptInput').value.trim();if(!prompt){toast('???????');$('promptInput').focus();return;}if(model.requiredRefs&&!state.references.length){toast('????????');return;}if(state.references.length&&!model.refs){toast('?????????');return;}
  if(Date.now()-state.lastSubmitAt<600)return;
  state.lastSubmitAt=Date.now();
  const input={type:state.view,modelId:model.id,prompt,presetId:state.presetId,resolutionId:state.view==='image'?state.resolutionId:undefined,referenceIds:state.references.map(r=>r.id),referenceDimensions:referenceDimensions(),seconds:Number($('secondsSelect').value)};
  state.activeSubmissions++;$('generateButton').innerHTML=`<span>?</span> ???? ? ${state.activeSubmissions} ???? <span class="button-arrow">?</span>`;
  try{const result=await window.workbench.generate(input);toast(result.status==='cleared'?'?????????':result.status==='complete'?'????????????':'???????????????');state.history=await window.workbench.history();renderHistory();}
  catch(e){toast((e.message||'????').replace(/^Error invoking remote method '[^']+': Error: /,''));state.history=await window.workbench.history();renderHistory();}
  finally{state.activeSubmissions--;const count=state.activeSubmissions;$('generateButton').innerHTML=`<span>?</span> ${count?`???? ? ${count} ????`:'????'} <span class="button-arrow">?</span>`;}
}
function bindEvents(){document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));$('allHistoryButton').addEventListener('click',()=>setView('history'));
  $('expandPromptButton').addEventListener('click',()=>{const wrap=document.querySelector('.prompt-input-wrap');const expanded=wrap.classList.toggle('expanded');const button=$('expandPromptButton');button.setAttribute('aria-expanded',String(expanded));button.setAttribute('aria-label',expanded?'????????':'????????');button.title=expanded?'????????':'????????';button.textContent=expanded?'?':'?';$('promptInput').focus();if(expanded)requestAnimationFrame(()=>$('promptInput').scrollIntoView({block:'center',behavior:'smooth'}));});
  $('closeImagePreview').addEventListener('click',()=>$('imagePreviewDialog').close());
  $('imagePreviewDialog').addEventListener('click',event=>{if(event.target===$('imagePreviewDialog'))$('imagePreviewDialog').close();});
  $('imagePreviewDialog').addEventListener('close',()=>{$('imagePreview').removeAttribute('src');});
  $('clearHistoryButton').addEventListener('click',async()=>{try{const result=await window.workbench.clearHistory();if(result.cleared){state.history=[];renderHistory();toast(`??? ${result.count} ?????`);}}catch(error){toast(error.message);}});
  $('themeToggle').addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
  $('updateButton').addEventListener('click',()=>$('updateDialog').showModal());
  $('closeUpdateDialog').addEventListener('click',()=>$('updateDialog').close());
  $('updateLaterButton').addEventListener('click',()=>$('updateDialog').close());
  $('updateDialog').addEventListener('close',()=>{if(state.update.state==='available')state.dismissedUpdateVersion=state.update.version;if(state.update.state==='ready')state.dismissedReadyVersion=state.update.version;});
  $('updateActionButton').addEventListener('click',async()=>{const status=state.update.state;try{if(status==='available'){renderUpdate({state:'downloading',percent:0});await window.workbench.downloadUpdate();}else if(status==='ready')await window.workbench.installUpdate();else if(status==='error')await window.workbench.checkUpdates();}catch(error){renderUpdate({state:'error',message:error.message});toast(error.message);}});
  window.workbench.onNotice(toast);
  $('promptInput').addEventListener('input',()=>{$('promptCount').textContent=`${$('promptInput').value.length} / 8000`;updateSizeNote();});$('modelSelect').addEventListener('change',e=>{state.modelId=e.target.value;renderModels();});
  $('ratioGrid').addEventListener('change',e=>{state.presetId=e.target.value;updateSizeNote();});
  $('resolutionSelect').addEventListener('change',e=>{state.resolutionId=e.target.value;state.resolutionsByModel[currentModel().id]=e.target.value;updateSizeNote();});
  $('addReference').addEventListener('click',async()=>{try{await appendReferences(await window.workbench.chooseReferences());}catch(e){toast(e.message);}});
  const dropzone=$('addReference');
  const hasDraggedFiles=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
  document.addEventListener('dragover',event=>{if(!hasDraggedFiles(event))return;event.preventDefault();const allowed=!$('creationView').hidden&&currentModel()?.refs&&!$('settingsDialog').open&&!$('updateDialog').open&&!$('imagePreviewDialog').open;event.dataTransfer.dropEffect=allowed?'copy':'none';dropzone.classList.toggle('drag-active',!!allowed);});
  document.addEventListener('dragleave',event=>{if(!event.relatedTarget)dropzone.classList.remove('drag-active');});
  document.addEventListener('drop',async event=>{if(!hasDraggedFiles(event))return;event.preventDefault();dropzone.classList.remove('drag-active');if($('creationView').hidden||$('settingsDialog').open||$('updateDialog').open||$('imagePreviewDialog').open)return;try{await addDroppedReferences(event.dataTransfer.files);}catch(error){toast(error.message);}});
  $('generateButton').addEventListener('click',doGenerate);$('settingsButton').addEventListener('click',()=>{$('apiKeyInput').value='';$('baseUrlInput').value=state.settings.baseUrl;renderConnection();$('settingsDialog').showModal();});
  $('baseUrlInput').addEventListener('input',()=>{$('keyStoredNote').textContent='???????????? API Key???????????????? Key?';});
  $('closeSettingsDialog').addEventListener('click',()=>$('settingsDialog').close());
  $('toggleKey').addEventListener('click',()=>{const input=$('apiKeyInput');input.type=input.type==='password'?'text':'password';$('toggleKey').textContent=input.type==='password'?'??':'??';});
  $('settingsForm').addEventListener('submit',async e=>{e.preventDefault();try{const result=await window.workbench.saveSettings({baseUrl:$('baseUrlInput').value,apiKey:$('apiKeyInput').value});applyModelSnapshot(result);$('settingsDialog').close();toast(result.syncError?'?????????????'+result.syncError:'API ???????????');}catch(err){toast(err.message);}});
  $('verifyKeyButton').addEventListener('click',async()=>{const b=$('verifyKeyButton');b.disabled=true;b.textContent='????';try{const result=await window.workbench.verifySettings({baseUrl:$('baseUrlInput').value,apiKey:$('apiKeyInput').value});toast(result.authVerified?'??????? Key ??? '+result.modelCount+' ?????':'??? '+result.modelCount+' ?????????????????? Key ??');}catch(e){toast('?????'+e.message);}finally{b.disabled=false;b.textContent='????';}});
  $('clearKeyButton').addEventListener('click',async()=>{try{applyModelSnapshot(await window.workbench.saveSettings({baseUrl:$('baseUrlInput').value,clearKey:true}));$('apiKeyInput').value='';toast('?????????? API Key');}catch(e){toast(e.message);}});
  $('syncModelsButton').addEventListener('click',async()=>{const button=$('syncModelsButton');button.disabled=true;button.textContent='????';try{const result=await window.workbench.syncModels();applyModelSnapshot(result);toast('??? '+result.imageModels.length+' ?????'+(result.unsupportedCount?'?'+result.unsupportedCount+' ?????':''));}catch(error){toast('?????'+error.message);}finally{button.disabled=false;button.textContent='???? ?';}});
  window.workbench.onModels(snapshot=>{applyModelSnapshot(snapshot);});
  window.workbench.onModelSyncError(error=>toast('?????????'+error));
  window.workbench.onHistory(data=>{state.history=data;renderHistory();});window.workbench.onUpdate(data=>{renderUpdate(data);if(data.state==='ready')toast(`??? ${data.version} ???????????`);});
}
async function boot(){bindActivation();try{const init=await window.workbench.init();applyWallpaper(init.wallpaper);$('activationVersion').textContent=`????? v${init.version}`;if(init.license.active)initializeWorkspace(init);else showActivation(init.license);}catch(e){$('activationMessage').textContent=`?????${e.message}`;$('activationMessage').className='activation-message error';}}
boot();
