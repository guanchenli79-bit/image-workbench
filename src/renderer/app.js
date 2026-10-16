const $ = id => document.getElementById(id);
const state = {view:'image',presetId:'auto',modelId:'gpt-image-2-vip',resolutionId:null,resolutionsByModel:{},references:[],imageModels:[],videoModels:[],presets:[],history:[],settings:null,activeSubmissions:0,lastSubmitAt:0,update:{state:'idle',version:null,percent:0},dismissedUpdateVersion:null,dismissedReadyVersion:null};
let toastTimer;
let sizeNoteRequest=0;

function setTheme(theme){
  const chosen=theme==='dark'?'dark':'light';
  document.documentElement.dataset.theme=chosen;
  localStorage.setItem('workbench-theme',chosen);
  const button=$('themeToggle');
  button.textContent=chosen==='dark'?'☀ 浅色模式':'☾ 深色模式';
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
  select.value=state.modelId;$('modelCount').textContent=`内置 ${models.length} 个模型`;
  const model=currentModel();$('modelName').textContent=model.label;$('modelFamily').textContent=model.family.toUpperCase();
  $('modelDesc').textContent=model.requiredRefs?'此模型必须上传参考图':model.refs?'支持文字与参考图创作':'仅支持文字提示词创作';
  $('referenceHint').textContent=model.requiredRefs?'必填 · 请添加参考图':model.refs?'可选 · 支持多图':'此模型不支持参考图';
  $('addReference').disabled=!model.refs;
  const seconds=$('secondsSelect');seconds.replaceChildren();
  if(state.view==='video')for(const n of model.seconds){const o=document.createElement('option');o.value=n;o.textContent=n;seconds.append(o);}
  $('secondsLabel').hidden=state.view!=='video';
  renderResolutions();
  updateSizeNote();
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
}
function renderRatios() {
  const grid=$('ratioGrid');grid.replaceChildren();
  for(const preset of state.presets){
    const option=document.createElement('option');option.value=preset.id;
    option.textContent=preset.id==='auto'?'auto · 自动识别':preset.label;
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
function mediaElement(record,index=0){if(record.status!=='complete'||!record.media?.[index])return null;const el=document.createElement(record.type==='video'?'video':'img');el.src=record.media[index];if(record.type==='video'){el.controls=true;el.preload='metadata';}else{el.alt=record.prompt;el.classList.add('zoomable-image');el.title='双击放大查看';el.addEventListener('dblclick',()=>showImagePreview(el.src,el.alt));}return el;}
function progressElement(record){if(!['submitting','pending','complete'].includes(record.status))return null;const progress=Number(record.progress);const known=record.status==='complete'||(record.status==='pending'&&Number.isFinite(progress)&&progress>0);const percent=record.status==='complete'?100:known?Math.min(99,Math.max(1,Math.round(progress))):0;const box=document.createElement('div');box.className=`task-progress${known?'':' task-progress-indeterminate'}${record.status==='complete'?' task-progress-complete':''}`;box.setAttribute('role','progressbar');box.setAttribute('aria-label',record.type==='video'?'视频生成进度':'图片生成进度');if(known)box.setAttribute('aria-valuenow',String(percent));box.setAttribute('aria-valuemin','0');box.setAttribute('aria-valuemax','100');const label=document.createElement('div');label.className='task-progress-label';label.innerHTML=`<span>${record.status==='complete'?'生成完成':record.status==='submitting'?'正在提交':'正在生成'}</span><span>${known?`${percent}%`:'处理中'}</span>`;const track=document.createElement('div');track.className='task-progress-track';const fill=document.createElement('span');fill.className='task-progress-fill';if(known)fill.style.width=`${percent}%`;track.append(fill);box.append(label,track);return box;}
function renderRecentCard(record){const card=document.createElement('article');card.className='recent-card';const thumb=document.createElement('div');thumb.className='recent-thumb';const media=mediaElement(record);if(media)thumb.append(media);else{const p=document.createElement('span');p.className='thumb-placeholder';p.textContent=record.type==='video'?'▶':'✦';thumb.append(p);}const status=document.createElement('span');status.className='recent-status';status.textContent=statusLabel(record);thumb.append(status);
  const meta=document.createElement('div');meta.className='recent-meta';const title=document.createElement('strong');title.textContent=record.prompt;const small=document.createElement('small');small.textContent=`${record.modelName} · ${formatDate(record.createdAt)}`;meta.append(title,small);
  const progress=progressElement(record);if(progress)meta.append(progress);
  if(record.status==='complete'){const actions=document.createElement('div');actions.className='recent-actions';record.media.forEach((_,i)=>{const b=document.createElement('button');b.textContent=record.media.length>1?`保存第 ${i+1} 张`:'保存作品';b.addEventListener('click',()=>saveMedia(record,i));actions.append(b);});meta.append(actions);}else if(record.status==='failed'){const error=document.createElement('small');error.textContent=record.error||record.lastPollError||'请求失败';meta.append(error);}else if(record.status==='expired'){const expired=document.createElement('small');expired.textContent='临时文件已自动清理';meta.append(expired);}card.append(thumb,meta);return card;}
function renderHistory(){const recent=$('recentList');const full=$('historyFullList');$('clearHistoryButton').disabled=!state.history.length;recent.replaceChildren();full.replaceChildren();if(!state.history.length){const empty=document.createElement('div');empty.className='empty-history';const s=document.createElement('span');s.textContent='✦';empty.append(s,document.createTextNode('还没有作品\n开始第一次创作吧'));recent.append(empty);const clone=empty.cloneNode(true);full.append(clone);return;}
  state.history.slice(0,8).forEach(r=>recent.append(renderRecentCard(r)));
  for(const r of state.history){const card=document.createElement('article');card.className='history-card';const preview=document.createElement('div');preview.className='history-preview';const media=mediaElement(r);if(media)preview.append(media);else{const p=document.createElement('span');p.className='thumb-placeholder';p.textContent=r.status==='expired'?'◷':r.type==='video'?'▶':'✦';preview.append(p);}const copy=document.createElement('div');copy.className='history-copy';const h=document.createElement('h3');h.textContent=r.modelName;const p=document.createElement('p');p.textContent=r.prompt;const small=document.createElement('small');small.textContent=`${formatDate(r.createdAt)} · ${statusLabel(r)}${r.actualSize?' · '+r.actualSize:''}`;copy.append(h,p,small);const progress=progressElement(r);if(progress)copy.append(progress);if(r.status==='complete'){r.media.forEach((_,i)=>{const b=document.createElement('button');b.textContent=r.media.length>1?`保存 ${i+1}`:'保存作品';b.addEventListener('click',()=>saveMedia(r,i));copy.append(b);});}if(r.status==='failed'){const err=document.createElement('p');err.textContent=r.error||r.lastPollError||'';copy.append(err);}card.append(preview,copy);full.append(card);}
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
  $('closeSettingsDialog').addEventListener('click',()=>$('settingsDialog').close());
  $('toggleKey').addEventListener('click',()=>{const input=$('apiKeyInput');input.type=input.type==='password'?'text':'password';$('toggleKey').textContent=input.type==='password'?'显示':'隐藏';});
  $('settingsForm').addEventListener('submit',async e=>{e.preventDefault();try{state.settings=await window.workbench.saveSettings({baseUrl:$('baseUrlInput').value,apiKey:$('apiKeyInput').value});renderConnection();$('settingsDialog').close();toast('API 设置已保存');}catch(err){toast(err.message);}});
  $('verifyKeyButton').addEventListener('click',async()=>{const b=$('verifyKeyButton');b.disabled=true;b.textContent='测试中…';try{const result=await window.workbench.verifySettings({baseUrl:$('baseUrlInput').value,apiKey:$('apiKeyInput').value});toast(`连接成功，当前 Key 可读取 ${result.modelCount??'可用'} 个模型`);}catch(e){toast(`连接失败：${e.message}`);}finally{b.disabled=false;b.textContent='测试连接';}});
  $('clearKeyButton').addEventListener('click',async()=>{try{state.settings=await window.workbench.saveSettings({baseUrl:$('baseUrlInput').value,clearKey:true});$('apiKeyInput').value='';renderConnection();toast('已清除本机保存的 API Key');}catch(e){toast(e.message);}});
  window.workbench.onHistory(data=>{state.history=data;renderHistory();});window.workbench.onUpdate(data=>{renderUpdate(data);if(data.state==='ready')toast(`新版本 ${data.version} 已下载，可选择重启安装`);});
}
async function boot(){try{const init=await window.workbench.init();Object.assign(state,{settings:init.settings,imageModels:init.imageModels,videoModels:init.videoModels,presets:init.presets,history:init.history});$('versionLabel').textContent=`v${init.version}`;renderConnection();renderRatios();renderModels();renderHistory();bindEvents();}catch(e){toast(`启动失败：${e.message}`);}}
boot();
