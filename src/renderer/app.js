const $ = id => document.getElementById(id);
const state = {view:'image',presetId:'auto',modelId:'gpt-image-2-vip',references:[],imageModels:[],videoModels:[],presets:[],history:[],settings:null,busy:false};
let toastTimer;

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
  updateSizeNote();
}
function renderRatios() {
  const grid=$('ratioGrid');grid.replaceChildren();
  for(const preset of state.presets){
    const option=document.createElement('option');option.value=preset.id;
    option.textContent=preset.id==='auto'?'auto · 自动识别':`${preset.label} · ${preset.dimensions}`;
    grid.append(option);
  }
  grid.value=state.presetId;
}
function referenceDimensions(){return state.references[0]?{width:state.references[0].width,height:state.references[0].height}:null;}
async function updateSizeNote() {
  const model=currentModel();if(!model)return;
  try{const result=await window.workbench.resolveSize({modelId:model.id,presetId:state.presetId,prompt:$('promptInput').value,referenceDimensions:referenceDimensions()});
    if(!result)return;
    const label=result.size?`实际提交尺寸：${result.size} · 比例 ${result.ratio}`:`实际提交比例：${result.ratio}`;
    $('resolvedSize').textContent=label+(result.adjusted?'（已按模型能力适配）':'');
  }catch{}
}
function renderReferences(){const host=$('referenceList');host.replaceChildren();for(const r of state.references){const card=document.createElement('div');card.className='reference-card';const img=document.createElement('img');img.src=r.preview;img.alt=r.name;const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.title='移除参考图';remove.addEventListener('click',()=>{window.workbench.clearReferences([r.id]);state.references=state.references.filter(x=>x.id!==r.id);renderReferences();updateSizeNote();});card.append(img,remove);host.append(card);}}
function setView(view) {
  state.view=view;document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===view));
  const history=view==='history';$('creationView').hidden=history;$('historyView').hidden=!history;
  $('breadcrumbCurrent').textContent=view==='video'?'BRING IDEAS TO LIFE':'CREATE SOMETHING NEW';
  $('formTitle').textContent=view==='video'?'视频创作':'图像创作';
  $('actionHint').textContent=view==='video'?'准备就绪，开始创作你的视频':'准备就绪，开始创作你的图像';
  $('promptInput').placeholder=view==='video'?'描述场景、动作和镜头运动……':'描述你想创作的画面、风格与细节……';
  if(!history)renderModels();else renderHistory();
}
function statusLabel(record){return {submitting:'提交中',pending:`生成中 ${record.progress||0}%`,complete:'已完成',failed:'生成失败',expired:'已过期'}[record.status]||record.status;}
function mediaElement(record,index=0){if(record.status!=='complete'||!record.media?.[index])return null;const el=document.createElement(record.type==='video'?'video':'img');el.src=record.media[index];if(record.type==='video'){el.controls=true;el.preload='metadata';}else el.alt=record.prompt;return el;}
function renderRecentCard(record){const card=document.createElement('article');card.className='recent-card';const thumb=document.createElement('div');thumb.className='recent-thumb';const media=mediaElement(record);if(media)thumb.append(media);else{const p=document.createElement('span');p.className='thumb-placeholder';p.textContent=record.type==='video'?'▶':'✦';thumb.append(p);}const status=document.createElement('span');status.className='recent-status';status.textContent=statusLabel(record);thumb.append(status);
  const meta=document.createElement('div');meta.className='recent-meta';const title=document.createElement('strong');title.textContent=record.prompt;const small=document.createElement('small');small.textContent=`${record.modelName} · ${formatDate(record.createdAt)}`;meta.append(title,small);
  if(record.status==='complete'){const actions=document.createElement('div');actions.className='recent-actions';record.media.forEach((_,i)=>{const b=document.createElement('button');b.textContent=record.media.length>1?`保存第 ${i+1} 张`:'保存作品';b.addEventListener('click',()=>saveMedia(record,i));actions.append(b);});meta.append(actions);}else if(record.status==='failed'){const error=document.createElement('small');error.textContent=record.error||record.lastPollError||'请求失败';meta.append(error);}else if(record.status==='expired'){const expired=document.createElement('small');expired.textContent='临时文件已自动清理';meta.append(expired);}card.append(thumb,meta);return card;}
function renderHistory(){const recent=$('recentList');const full=$('historyFullList');recent.replaceChildren();full.replaceChildren();if(!state.history.length){const empty=document.createElement('div');empty.className='empty-history';const s=document.createElement('span');s.textContent='✦';empty.append(s,document.createTextNode('还没有作品\n开始第一次创作吧'));recent.append(empty);const clone=empty.cloneNode(true);full.append(clone);return;}
  state.history.slice(0,8).forEach(r=>recent.append(renderRecentCard(r)));
  for(const r of state.history){const card=document.createElement('article');card.className='history-card';const preview=document.createElement('div');preview.className='history-preview';const media=mediaElement(r);if(media)preview.append(media);else{const p=document.createElement('span');p.className='thumb-placeholder';p.textContent=r.status==='expired'?'◷':r.type==='video'?'▶':'✦';preview.append(p);}const copy=document.createElement('div');copy.className='history-copy';const h=document.createElement('h3');h.textContent=r.modelName;const p=document.createElement('p');p.textContent=r.prompt;const small=document.createElement('small');small.textContent=`${formatDate(r.createdAt)} · ${statusLabel(r)}${r.actualSize?' · '+r.actualSize:''}`;copy.append(h,p,small);if(r.status==='complete'){r.media.forEach((_,i)=>{const b=document.createElement('button');b.textContent=r.media.length>1?`保存 ${i+1}`:'保存作品';b.addEventListener('click',()=>saveMedia(r,i));copy.append(b);});}if(r.status==='failed'){const err=document.createElement('p');err.textContent=r.error||r.lastPollError||'';copy.append(err);}card.append(preview,copy);full.append(card);}
}
async function saveMedia(record,index){try{const done=await window.workbench.saveResult(record.id,index);if(done)toast('作品已永久保存到所选位置');}catch(e){toast(e.message);}}
async function doGenerate(){if(state.busy)return;if(!state.settings.hasKey){$('settingsDialog').showModal();toast('请先设置 API Key');return;}const model=currentModel();const prompt=$('promptInput').value.trim();if(!prompt){toast('请先填写提示词');$('promptInput').focus();return;}if(model.requiredRefs&&!state.references.length){toast('该模型需要参考图');return;}if(state.references.length&&!model.refs){toast('该模型不支持参考图');return;}
  state.busy=true;$('generateButton').disabled=true;$('generateButton').textContent='正在提交…';
  try{const result=await window.workbench.generate({type:state.view,modelId:model.id,prompt,presetId:state.presetId,referenceIds:state.references.map(r=>r.id),referenceDimensions:referenceDimensions(),seconds:Number($('secondsSelect').value)});toast(result.status==='complete'?'生成完成，请及时保存作品':'任务已提交，生成进度会显示在历史区');state.history=await window.workbench.history();renderHistory();}
  catch(e){toast(e.message||'生成失败');state.history=await window.workbench.history();renderHistory();}
  finally{state.busy=false;$('generateButton').disabled=false;$('generateButton').innerHTML='<span>✦</span> 立即生成 <span class="button-arrow">↗</span>';}
}
function bindEvents(){document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));$('allHistoryButton').addEventListener('click',()=>setView('history'));
  window.workbench.onNotice(toast);
  $('promptInput').addEventListener('input',()=>{$('promptCount').textContent=`${$('promptInput').value.length} / 8000`;updateSizeNote();});$('modelSelect').addEventListener('change',e=>{state.modelId=e.target.value;renderModels();});
  $('ratioGrid').addEventListener('change',e=>{state.presetId=e.target.value;updateSizeNote();});
  $('addReference').addEventListener('click',async()=>{try{const found=await window.workbench.chooseReferences();for(const item of found){const img=new Image();img.src=item.preview;await img.decode().catch(()=>{});item.width=img.naturalWidth;item.height=img.naturalHeight;}state.references.push(...found);renderReferences();updateSizeNote();}catch(e){toast(e.message);}});
  $('generateButton').addEventListener('click',doGenerate);$('settingsButton').addEventListener('click',()=>{$('apiKeyInput').value='';$('baseUrlInput').value=state.settings.baseUrl;renderConnection();$('settingsDialog').showModal();});
  $('closeSettingsDialog').addEventListener('click',()=>$('settingsDialog').close());
  $('toggleKey').addEventListener('click',()=>{const input=$('apiKeyInput');input.type=input.type==='password'?'text':'password';$('toggleKey').textContent=input.type==='password'?'显示':'隐藏';});
  $('settingsForm').addEventListener('submit',async e=>{e.preventDefault();try{state.settings=await window.workbench.saveSettings({baseUrl:$('baseUrlInput').value,apiKey:$('apiKeyInput').value});renderConnection();$('settingsDialog').close();toast('API 设置已保存');}catch(err){toast(err.message);}});
  $('verifyKeyButton').addEventListener('click',async()=>{const b=$('verifyKeyButton');b.disabled=true;b.textContent='测试中…';try{const result=await window.workbench.verifySettings({baseUrl:$('baseUrlInput').value,apiKey:$('apiKeyInput').value});toast(`连接成功，当前 Key 可读取 ${result.modelCount??'可用'} 个模型`);}catch(e){toast(`连接失败：${e.message}`);}finally{b.disabled=false;b.textContent='测试连接';}});
  $('clearKeyButton').addEventListener('click',async()=>{try{state.settings=await window.workbench.saveSettings({baseUrl:$('baseUrlInput').value,clearKey:true});$('apiKeyInput').value='';renderConnection();toast('已清除本机保存的 API Key');}catch(e){toast(e.message);}});
  window.workbench.onHistory(data=>{state.history=data;renderHistory();});window.workbench.onUpdate(data=>{if(data.state==='ready'){toast(`新版本 ${data.version} 已下载，关闭应用时自动安装`);$('versionLabel').textContent=`更新就绪 v${data.version}`;}else if(data.state==='downloading')$('versionLabel').textContent=`更新下载 ${data.percent}%`;});
}
async function boot(){try{const init=await window.workbench.init();Object.assign(state,{settings:init.settings,imageModels:init.imageModels,videoModels:init.videoModels,presets:init.presets,history:init.history});$('versionLabel').textContent=`v${init.version}`;renderConnection();renderRatios();renderModels();renderHistory();bindEvents();}catch(e){toast(`启动失败：${e.message}`);}}
boot();
