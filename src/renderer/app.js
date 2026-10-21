const $=id=>document.getElementById(id);
const state={mode:'text',modelId:'',models:[],selectedIds:[],referenceWeights:new Map(),expandedThoughts:new Set(),files:[],history:[],settings:null,syncInfo:null,presetId:'auto',resolutionId:'default',seconds:5,conversationId:null,activeRecordIds:new Set(),pendingSubmissions:[],view:'chat',textBusy:false,welcomeGreeting:''};
const MODES=[['text','语言模型'],['image','绘图模型'],['video','视频模型']];
let toastTimer;
const menuTimers=new WeakMap();
function nextGreeting(){const hour=new Date().getHours();const hello=hour<11?'早上好':hour<14?'中午好':hour<19?'下午好':'晚上好';const choices=[`${hello}，今天想聊些什么？`,`${hello}，有什么新想法？`,`${hello}，我们从哪里开始？`,`欢迎回来，随时开始吧`];let last=-1;try{last=Number(localStorage.getItem('lastGreetingIndex')??-1);}catch{}const next=(last+1+Math.floor(Math.random()*(choices.length-1)))%choices.length;try{localStorage.setItem('lastGreetingIndex',String(next));}catch{}return choices[next];}
function toast(message){$('toast').textContent=String(message||'操作失败');$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3500);}
function closeMenu(menu){if(menu.hidden)return;clearTimeout(menuTimers.get(menu));menu.classList.add('closing');menuTimers.set(menu,setTimeout(()=>{menu.hidden=true;menu.classList.remove('closing');},220));const button=document.querySelector(`[aria-controls="${menu.id}"]`);if(button)button.setAttribute('aria-expanded','false');}
function hideMenus(except){for(const id of ['modeMenu','modelMenu','ratioMenu','resolutionMenu','durationMenu','mentionMenu'])if(id!==except)closeMenu($(id));}
function toggleMenu(button,menu){if(menu.hidden||menu.classList.contains('closing')){hideMenus(menu.id);clearTimeout(menuTimers.get(menu));menu.hidden=false;menu.classList.remove('closing');button.setAttribute('aria-expanded','true');}else closeMenu(menu);}
function option(menu,label,click,detail='',selected=false,disabled=false,modelRow=false){const b=document.createElement('button');b.type='button';b.className=[selected?'selected':'',modelRow?'model-option':''].filter(Boolean).join(' ');b.disabled=disabled;if(modelRow){const logo=document.createElement('img');logo.className='model-logo';logo.src='../../assets/logo.svg';logo.alt='';b.append(logo);}const span=document.createElement('span');span.textContent=label;b.append(span);if(detail){const small=document.createElement('small');small.textContent=detail;b.append(small);}b.addEventListener('click',()=>{click();closeMenu(menu);});menu.append(b);}
function currentModels(){return state.models.filter(x=>x.type===state.mode);}
function model(){return currentModels().find(x=>x.id===state.modelId);}
function updateConnection(){const n=state.models.length;$('connectionText').textContent=state.settings?.hasKey?`${new URL(state.settings.baseUrl).hostname} · ${state.syncInfo?.authVerified?'已验证':'Key 待验证'}`:'尚未设置 API Key';$('modelSummary').textContent=state.syncInfo?.status==='ok'?`${n} 个模型 · ${state.syncInfo.source}`:'等待同步模型';}
function setMode(type){state.mode=type;state.modelId=currentModels().find(x=>x.supported)?.id||currentModels()[0]?.id||'';state.selectedIds=state.selectedIds.filter(id=>state.files.some(f=>f.id===id&&model()?.accept?.includes(f.kind)));state.presetId='auto';renderControls();renderFiles();}
function renderControls(){const m=model();$('modeText').textContent=MODES.find(x=>x[0]===state.mode)?.[1];$('modelText').textContent=m?.label||'选择模型';$('mediaControls').hidden=state.mode==='text';$('durationControl').hidden=state.mode!=='video';
  const modeMenu=$('modeMenu');modeMenu.replaceChildren();for(const [id,label] of MODES){const count=state.models.filter(x=>x.type===id).length;option(modeMenu,label,()=>setMode(id),`${count} 个已发现模型`,id===state.mode);}
  const modelMenu=$('modelMenu');modelMenu.replaceChildren();if(!currentModels().length)option(modelMenu,'暂无模型，点击同步',()=>{});for(const row of currentModels())option(modelMenu,row.label,()=>{state.modelId=row.id;state.selectedIds=state.selectedIds.filter(id=>state.files.some(f=>f.id===id&&row.accept?.includes(f.kind)));state.presetId='auto';renderControls();renderFiles();if(!row.supported)toast(row.reason);},'',row.id===state.modelId,false,true);
  const ratios=['auto',...(m?.ratios||['1:1','16:9','9:16'])];if(!ratios.includes(state.presetId))state.presetId='auto';$('ratioText').textContent=state.presetId==='auto'?'auto 比例':state.presetId;const ratioMenu=$('ratioMenu');ratioMenu.replaceChildren();for(const r of ratios)option(ratioMenu,r==='auto'?'auto · 自动识别':r,()=>{state.presetId=r;renderControls();},'',r===state.presetId);
  const resolutions=m?.resolutions?.length?m.resolutions:['default'];if(!resolutions.includes(state.resolutionId))state.resolutionId=resolutions[0];$('resolutionText').textContent=state.resolutionId==='default'?'模型默认':state.resolutionId;const resolutionMenu=$('resolutionMenu');resolutionMenu.replaceChildren();for(const r of resolutions)option(resolutionMenu,r==='default'?'模型默认':r,()=>{state.resolutionId=r;renderControls();},'',r===state.resolutionId);
  const seconds=m?.seconds?.length?m.seconds:[5];if(!seconds.includes(state.seconds))state.seconds=seconds[0];$('durationText').textContent=`${state.seconds} 秒`;const durationMenu=$('durationMenu');durationMenu.replaceChildren();for(const sec of seconds)option(durationMenu,`${sec} 秒`,()=>{state.seconds=sec;renderControls();},'',sec===state.seconds);
  const accept=m?.accept?.length?m.accept.map(kindLabel).join('、'):'无';$('capabilityHint').textContent=!m?'同步模型后开始创作。':m.supported?`当前模型已确认支持：${accept}。输入 @ 引用已添加文件。`:m.reason||'此模型需要适配';$('sendButton').disabled=!m?.supported||(state.mode==='text'&&state.textBusy);
}
function kindLabel(k){return {image:'图片',document:'文档',video:'视频',audio:'音频'}[k]||k;}
function fileIcon(k){return {image:'▧',video:'▷',audio:'♫',document:'▤'}[k]||'▤';}
function removeMention(f){const prompt=$('prompt');const token=`@【${f.name}】`;if(prompt.value.includes(token)){prompt.value=prompt.value.replaceAll(token,'').replace(/ {2,}/g,' ');updateCount();}}
function renderFiles(){
  const host=$('selectedFiles');host.replaceChildren();
  for(const f of state.files){
    const supported=!!model()?.accept?.includes(f.kind);
    const selected=state.selectedIds.includes(f.id);
    const card=document.createElement('div');
    card.className=`reference-card${selected?' selected':''}${supported?'':' unavailable'}`;
    card.title=`${f.name} · 双击预览${supported?'':' · 当前模型不支持引用'}`;
    card.setAttribute('role','button');card.tabIndex=0;
    const visual=document.createElement(f.kind==='image'?'img':'span');visual.className='reference-visual';
    if(f.kind==='image')visual.src=f.preview;else visual.textContent=fileIcon(f.kind);
    const name=document.createElement('span');name.className='reference-name';name.textContent=f.name;
    const badge=document.createElement('span');badge.className='reference-badge';badge.textContent=selected?'已引用':supported?'点击引用':'不可引用';
    const remove=document.createElement('button');remove.className='reference-remove';remove.type='button';remove.title='移除文件';remove.textContent='×';
    remove.addEventListener('click',async e=>{e.stopPropagation();await window.studio.removeFile(f.id);state.files=state.files.filter(x=>x.id!==f.id);state.selectedIds=state.selectedIds.filter(x=>x!==f.id);state.referenceWeights.delete(f.id);removeMention(f);renderFiles();});
    const toggle=()=>{if(!supported){toast('当前模型不支持引用此类文件');return;}if(selected){state.selectedIds=state.selectedIds.filter(x=>x!==f.id);removeMention(f);}else if(state.selectedIds.length<10)state.selectedIds.push(f.id);else{toast('每次最多引用 10 个文件');return;}renderFiles();};
    let clickTimer;
    card.addEventListener('click',()=>{clearTimeout(clickTimer);clickTimer=setTimeout(toggle,230);});
    card.addEventListener('dblclick',e=>{e.preventDefault();clearTimeout(clickTimer);previewReference(f);});
    card.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();toggle();}});
    card.append(visual,name,badge,remove);
    if(selected&&supported){const weight=document.createElement('label');weight.className='reference-weight';weight.textContent='参考权重';weight.title='权重以文字提示方式传给模型，效果取决于模型是否遵循';weight.addEventListener('click',e=>e.stopPropagation());weight.addEventListener('dblclick',e=>e.stopPropagation());const input=document.createElement('input');input.type='number';input.min='0.1';input.max='2';input.step='0.1';input.value=(state.referenceWeights.get(f.id)||1).toFixed(1);input.setAttribute('aria-label',`${f.name} 的参考权重`);input.addEventListener('click',e=>e.stopPropagation());input.addEventListener('dblclick',e=>e.stopPropagation());input.addEventListener('keydown',e=>e.stopPropagation());input.addEventListener('change',()=>{const value=Math.round(Math.min(2,Math.max(.1,Number(input.value)||1))*10)/10;state.referenceWeights.set(f.id,value);input.value=value.toFixed(1);});weight.append(input);card.append(weight);}
    host.append(card);
  }
}
function openMention(query=''){const menu=$('mentionMenu');menu.replaceChildren();const m=model();const found=state.files.filter(f=>m?.accept?.includes(f.kind)&&f.name.toLowerCase().includes(query.toLowerCase()));if(!found.length){const d=document.createElement('div');d.className='empty';d.textContent=state.files.length?'当前模型没有可引用的匹配文件':'先用＋添加参考文件';menu.append(d);}for(const f of found){option(menu,`${fileIcon(f.kind)} ${f.name}`,()=>{if(!state.selectedIds.includes(f.id)){if(state.selectedIds.length>=10){toast('每次最多引用 10 个文件');return;}state.selectedIds.push(f.id);}renderFiles();const t=$('prompt');const pos=t.selectionStart;const before=t.value.slice(0,pos);const match=before.match(/@([^\s@\n]*)$/);if(match){const start=pos-match[0].length;const token=`@【${f.name}】 `;t.value=t.value.slice(0,start)+token+t.value.slice(pos);t.setSelectionRange(start+token.length,start+token.length);}t.focus();updateCount();},kindLabel(f.kind));}menu.hidden=false;}
function updateCount(){$('charCount').textContent=`${$('prompt').value.length} / 8000`;}
function selectAdded(added){state.files.push(...added);for(const f of added)if(model()?.accept?.includes(f.kind)&&state.selectedIds.length<10)state.selectedIds.push(f.id);renderFiles();}
async function addFiles(items){try{const data=[];for(const file of items){if(file.size>40*1024*1024)throw new Error(`${file.name} 超过 40 MB`);data.push({name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});}const added=await window.studio.addFiles(data);selectAdded(added);toast(`已添加 ${added.length} 个文件`);}catch(e){toast(e.message);}}
function showPreview(src,title='图片预览',kind='image'){const body=$('previewBody');body.replaceChildren();$('previewTitle').textContent=title;const element=document.createElement(kind==='video'?'video':kind==='audio'?'audio':'img');element.src=src;if(kind==='video'||kind==='audio'){element.controls=true;element.autoplay=false;}element.alt=title;body.append(element);$('previewDialog').showModal();}
async function previewReference(f){if(f.kind==='document'){try{const text=await window.studio.filePreview(f.id);const body=$('previewBody');body.replaceChildren();const pre=document.createElement('pre');pre.textContent=text;body.append(pre);$('previewTitle').textContent=f.name;$('previewDialog').showModal();}catch(e){toast(e.message);}}else showPreview(f.preview,f.name,f.kind);}
function progress(record){if(!['pending','submitting'].includes(record.status))return null;const bar=document.createElement('div');bar.className='progress'+(record.progress?'':' indeterminate');const fill=document.createElement('span');if(record.progress)fill.style.width=`${Math.min(99,record.progress)}%`;bar.append(fill);return bar;}
function renderConversation(){
  const host=$('conversation');host.replaceChildren();
  const current=state.history.filter(r=>state.activeRecordIds.has(r.id)).slice().reverse();
  document.querySelector('.main').classList.toggle('empty-chat',!current.length&&state.view==='chat');
  if(!current.length){const welcome=document.createElement('div');welcome.className='welcome';welcome.innerHTML='<div class="welcome-icon">✧</div><span>ONE SPACE, MANY IDEAS</span><h2></h2><p>选择语言、绘图或视频模式。键入 @ 引用上方文件，然后开始创作。</p><div class="welcome-chips"><span>长对话上下文</span><span>图像与视频创作</span><span>按模型筛选参考文件</span></div>';welcome.querySelector('h2').textContent=state.welcomeGreeting||'欢迎回来，随时开始吧';host.append(welcome);return;}
  for(const r of current){
    host.append(message('user','你',r.prompt));
    const answer=message('assistant','',r.type==='text'?'':r.status==='failed'?r.error:r.status==='complete'?'创作完成，请及时保存。':r.status==='pending'?`正在生成 · ${Math.round(r.progress||0)}%`:'正在提交…');
    answer.dataset.recordId=r.id;
    if(r.type==='text')updateTextAnswer(answer,r);
    if(r.status==='failed')answer.querySelector('.body').classList.add('error');
    addMedia(answer,r);const p=progress(r);if(p)answer.append(p);host.append(answer);
  }
  host.scrollTop=host.scrollHeight;
}
function updateTextAnswer(answer,r){
  const body=answer.querySelector('.body');
  body.textContent=r.status==='failed'?(r.error||'请求失败'):r.answer||'';
  let waiting=answer.querySelector('.thinking-state');
  if(['thinking','responding'].includes(r.status)){
    if(!waiting){waiting=document.createElement('div');waiting.className='thinking-state';waiting.innerHTML='<i></i><span></span>';answer.insertBefore(waiting,body);}
    waiting.querySelector('span').textContent=r.answer?'正在回复…':'正在思考…';
  }else waiting?.remove();
  let details=answer.querySelector('.thought-details');
  if(r.reasoning){
    if(!details){details=document.createElement('details');details.className='thought-details';const summary=document.createElement('summary');summary.textContent='思考过程';const text=document.createElement('pre');details.append(summary,text);answer.insertBefore(details,body);details.open=r.status!=='complete'||state.expandedThoughts.has(r.id);details.addEventListener('toggle',()=>{if(r.status==='complete'){if(details.open)state.expandedThoughts.add(r.id);else state.expandedThoughts.delete(r.id);}});}
    details.querySelector('pre').textContent=r.reasoning;
    if(r.status==='complete')details.open=false;
  }else details?.remove();
  body.hidden=!body.textContent&&r.status!=='failed';
}
function message(role,title,body){const box=document.createElement('article');box.className='message '+role;if(title){const meta=document.createElement('div');meta.className='meta';meta.textContent=title;box.append(meta);}const text=document.createElement('div');text.className='body';text.textContent=body;box.append(text);return box;}
function addMedia(target,r){if(r.status!=='complete'||!r.media?.length)return;const div=document.createElement('div');div.className='result-media';r.media.forEach((url,i)=>{const media=document.createElement(r.type==='video'?'video':'img');media.src=url;if(r.type==='video'){media.controls=true;media.preload='metadata';}else media.addEventListener('dblclick',()=>showPreview(url));div.append(media);const actions=document.createElement('div');actions.className='result-actions';const save=document.createElement('button');save.textContent='保存原文件';save.addEventListener('click',()=>window.studio.saveResult(r.id,i).catch(e=>toast(e.message)));const cite=document.createElement('button');cite.textContent='引用参数';cite.title='将本次创作参数加入输入框';cite.addEventListener('click',()=>{state.mode=r.type;state.modelId=r.modelId;state.presetId=r.ratio||'auto';state.resolutionId=r.resolution||'default';if(r.seconds)state.seconds=r.seconds;renderControls();const lines=[`参考这次${r.type==='video'?'视频':'绘图'}创作：`,r.prompt,`模型：${r.modelName||r.modelId}`,`画幅比例：${r.ratio||'auto'}`,`分辨率：${r.resolution||'模型默认'}`];if(r.type==='video'&&r.seconds)lines.push(`时长：${r.seconds} 秒`);const prompt=$('prompt');prompt.value=[prompt.value.trim(),lines.join('\n')].filter(Boolean).join('\n\n');updateCount();prompt.focus();toast('已引用创作参数');});const copy=document.createElement('button');copy.textContent='复制提示词';copy.title='复制本次生成使用的提示词';copy.addEventListener('click',()=>window.studio.copyText(r.prompt).then(()=>toast('已复制提示词')).catch(e=>toast(e.message)));if(r.type==='image'){const copyImage=document.createElement('button');copyImage.textContent='复制图片';copyImage.title='复制完整原图到系统剪切板';copyImage.addEventListener('click',()=>window.studio.copyImage(r.id,i).then(({width,height})=>toast('已复制原图 '+width+' × '+height+'，可以粘贴')).catch(e=>toast(e.message)));actions.append(copyImage);}actions.append(save,cite,copy);div.append(actions);});target.append(div);}
function renderHistory(){const host=$('historyList');host.replaceChildren();const records=state.history.filter(r=>r.type==='image'||r.type==='video');if(!records.length){const d=document.createElement('div');d.className='file-empty';d.textContent='还没有图片或视频生成记录';host.append(d);}for(const r of records){const card=document.createElement('article');card.className='history-card';const thumb=document.createElement(r.media?.length?(r.type==='video'?'video':'img'):'div');thumb.className='thumb';if(r.media?.length)thumb.src=r.media[0];else thumb.textContent=r.type==='video'?'▷':'▧';if(r.media?.length&&r.type==='image')thumb.addEventListener('dblclick',()=>showPreview(r.media[0]));const copy=document.createElement('div');copy.className='copy';const name=document.createElement('b');name.textContent=r.modelName;const p=document.createElement('p');p.textContent=r.prompt;const small=document.createElement('small');small.textContent=`${new Date(r.createdAt).toLocaleString()} · ${{complete:'已完成',failed:'失败',pending:'生成中',submitting:'提交中',expired:'已过期'}[r.status]||r.status}`;copy.append(name,p,small);if(r.media?.length){const b=document.createElement('button');b.textContent='保存';b.addEventListener('click',()=>window.studio.saveResult(r.id,0).catch(e=>toast(e.message)));copy.append(b);if(r.type==='image'){const copyImage=document.createElement('button');copyImage.textContent='复制图片';copyImage.addEventListener('click',()=>window.studio.copyImage(r.id,0).then(()=>toast('已复制原图，可以粘贴')).catch(e=>toast(e.message)));copy.append(copyImage);}}card.append(thumb,copy);host.append(card);}}
function renderConversationList(){const host=$('conversationList');host.replaceChildren();const groups=new Map();for(const r of [...state.history].reverse()){const id=r.conversationId||r.id;if(!groups.has(id))groups.set(id,{id,title:r.prompt,latest:r.createdAt});else groups.get(id).latest=Math.max(groups.get(id).latest,r.createdAt);}const rows=[...groups.values()].sort((a,b)=>b.latest-a.latest);if(!rows.length){const empty=document.createElement('div');empty.className='conversation-empty';empty.textContent='暂无对话';host.append(empty);}for(const row of rows){const button=document.createElement('button');button.className='conversation-link'+(row.id===state.conversationId?' active':'');button.title=row.title;button.textContent=row.title.length>24?row.title.slice(0,24)+'…':row.title;const small=document.createElement('small');small.textContent=new Date(row.latest).toLocaleDateString();button.append(small);button.addEventListener('click',()=>{state.conversationId=row.id;state.activeRecordIds=new Set(state.history.filter(r=>(r.conversationId||r.id)===row.id).map(r=>r.id));setView('chat');});host.append(button);}}
function renderHistoryAndConversation(){renderHistory();renderConversationList();if(state.view==='chat')renderConversation();}
function setView(view){state.view=view;$('conversation').hidden=view!=='chat';$('historyView').hidden=view!=='history';$('composerWrap').hidden=view!=='chat';$('pageTitle').textContent=view==='chat'?'创作对话':'生成历史';$('chatNav').classList.toggle('active',view==='chat');$('historyNav').classList.toggle('active',view==='history');document.querySelector('.main').classList.toggle('empty-chat',view==='chat'&&!state.activeRecordIds.size);renderHistoryAndConversation();}
async function send(){
  const m=model(),prompt=$('prompt').value.trim();
  if(!m?.supported){toast(m?.reason||'请先选择可调用模型');return;}
  if(!prompt){$('prompt').focus();return;}
  if(state.mode==='text'&&state.textBusy)return;
  if(!state.conversationId)state.conversationId=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const clientRequestId=globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const input={type:state.mode,modelId:m.id,prompt,fileIds:[...state.selectedIds],referenceWeights:Object.fromEntries(state.selectedIds.map(id=>[id,state.referenceWeights.get(id)||1])),conversationId:state.conversationId,presetId:state.presetId,resolutionId:state.resolutionId,seconds:state.seconds,clientRequestId};
  const localId=`local-${clientRequestId}`;
  const submission={clientRequestId,localId};state.pendingSubmissions.push(submission);
  const optimistic={id:localId,clientRequestId,conversationId:state.conversationId,type:state.mode,modelId:m.id,modelName:m.label,prompt,answer:'',reasoning:'',status:state.mode==='text'?'thinking':'submitting',createdAt:Date.now(),media:[]};
  state.history.unshift(optimistic);state.activeRecordIds.add(localId);
  if(state.mode==='text')state.textBusy=true;
  $('prompt').value='';state.selectedIds=[];renderFiles();updateCount();renderControls();renderHistoryAndConversation();
  try{
    const result=await window.studio.submit(input);
    if(state.conversationId===input.conversationId)state.activeRecordIds.add(input.type==='text'?result.record.id:result.id);
    state.activeRecordIds.delete(localId);
    state.history=await window.studio.history();renderHistoryAndConversation();
  }catch(e){
    toast(e.message.replace(/^Error invoking remote method '[^']+': Error: /,''));
    if(!$('prompt').value)$('prompt').value=prompt;
    updateCount();state.activeRecordIds.delete(localId);
    state.history=await window.studio.history();renderHistoryAndConversation();
  }finally{state.pendingSubmissions=state.pendingSubmissions.filter(x=>x!==submission);if(input.type==='text')state.textBusy=false;renderControls();}
}
async function saveSettings(){const b=$('saveSettings');b.disabled=true;$('settingsMessage').textContent='正在连接并同步模型…';try{const result=await window.studio.saveSettings({baseUrl:$('baseUrl').value,apiKey:$('apiKey').value});state.settings=result.settings;state.models=result.models||[];state.syncInfo=result.syncInfo;if(result.error){$('settingsMessage').textContent=result.error;toast('设置已保存，模型同步需要适配');}else{$('settingsDialog').close();$('apiKey').value='';toast(`已同步 ${state.models.length} 个模型`);}setMode(state.mode);updateConnection();}catch(e){$('settingsMessage').textContent=e.message;}finally{b.disabled=false;}}
async function enterGateway(){const button=$('gatewayEnter');button.disabled=true;$('gatewayStatus').textContent='正在连接并匹配模型…';try{const result=await window.studio.saveSettings({baseUrl:$('gatewayUrl').value,apiKey:$('gatewayKey').value});state.settings=result.settings;state.models=result.models||[];state.syncInfo=result.syncInfo;setMode('text');updateConnection();if(result.error&&!result.models?.length){$('gatewayStatus').textContent=result.error;return;}if(result.error)toast(`使用上次模型列表进入：${result.error}`);$('gateway').hidden=true;$('shell').hidden=false;renderHistoryAndConversation();}catch(e){$('gatewayStatus').textContent=e.message;}finally{button.disabled=false;}}
function applyWallpaper(value){
  const layer=$('wallpaperLayer');layer.replaceChildren();
  if(!value?.url)return;
  const media=document.createElement(value.kind==='video'?'video':'img');media.src=value.url;
  if(value.kind==='video'){media.autoplay=true;media.muted=true;media.loop=true;media.playsInline=true;media.addEventListener('loadeddata',()=>media.play().catch(()=>{}));}
  layer.append(media);
}
function showActivation(status){$('activation').hidden=false;$('gateway').hidden=true;$('shell').hidden=true;$('activationMessage').textContent=status?.message||'请提交使用申请';$('machineCodeValue').textContent=status?.machineCode||'读取失败';$('copyMachineCode').disabled=!status?.machineCode;}
async function enterLicensedWorkspace(){
  const data=await window.studio.init();
  if(!data.license.active){showActivation(data.license);return;}
  Object.assign(state,{settings:data.settings,models:data.models||[],syncInfo:data.syncInfo,files:data.files||[],history:data.history||[]});
  setMode('text');renderFiles();updateConnection();updateCount();renderHistoryAndConversation();
  $('gatewayUrl').value=state.settings.baseUrl;
  $('gatewayKeyHint').textContent=state.settings.hasKey?`已保存此接口的 Key（尾号 ${state.settings.keyTail}），可留空直接进入。`:'首次进入请填写当前接口的 API Key。';
  $('activation').hidden=true;$('gateway').hidden=!!state.settings.hasKey;$('shell').hidden=!state.settings.hasKey;
}
function diagnosticRow(label,status,detail){
  const host=$('diagnosticRows');
  let row=[...host.children].find(item=>item.dataset.label===label);
  if(!row){row=document.createElement('div');row.dataset.label=label;host.append(row);}
  row.className=`diagnostic-row ${status||''}`;
  row.replaceChildren();
  const heading=document.createElement('strong');heading.textContent=label;
  const description=document.createElement('small');description.textContent=detail||'';
  row.append(heading,description);
}
async function checkConnection(){
  const button=$('checkConnection');button.disabled=true;
  $('diagnosticRows').replaceChildren();$('diagnosticSummary').textContent='正在检查接口地址、密钥格式和模型能力…';
  if(!$('diagnosticDialog').open)$('diagnosticDialog').showModal();
  try{
    const report=await window.studio.diagnoseConnection({baseUrl:$('baseUrl').value,apiKey:$('apiKey').value});
    $('baseUrl').value=report.baseUrl;
    if(report.removedBearer&&$('apiKey').value)$('apiKey').value=$('apiKey').value.trim().replace(/^Bearer\s+/i,'').trim();
    report.repairs.forEach((repair,index)=>diagnosticRow(`自动修复 ${index+1}`,'passed',repair));
    diagnosticRow('模型列表',report.authVerified?'passed':'',`${report.modelCount} 个模型 · ${report.source}。${report.authVerified?'带 Key 的模型列表请求已成功；生成权限尚未验证':'列表可能来自公开页面；API Key 尚未验证'}`);
    for(const scenario of report.scenarios){
      const detail=scenario.status==='ready'?`已匹配路径：${scenario.modelName} · ${scenario.route}`:'当前端口没有已适配的此类模型';
      diagnosticRow(scenario.label,'',detail);
    }
    $('diagnosticSummary').textContent=report.authVerified?'检查完成，模型列表链接通畅；已核对已知调用路径。未提交提示词或发起生成，生成权限及结果尚未验证。':'检查完成，已读取模型列表并核对已知调用路径；API Key 尚未验证。未提交提示词或发起生成。';
  }catch(error){
    $('diagnosticSummary').textContent=`检查出来连接错误：${error.message}。无法自动修复时，请检查 URL、API Key 与网络。`;
    diagnosticRow('连接失败','failed',error.message);
  }finally{button.disabled=false;}
}
function renderUpdate(data){
  const check=$('checkUpdateButton');
  check.disabled=data.state==='checking';
  check.textContent=data.state==='checking'?'检查中…':'检查更新';
  if(data.state==='checking')return;
  if(data.state==='current'){
    if(state.manualUpdateCheck)toast('当前已是最新版本');
    state.manualUpdateCheck=false;
    return;
  }
  if(data.state==='error'){
    if(state.manualUpdateCheck)toast(`检查更新失败：${data.message||'请稍后重试'}`);
    state.manualUpdateCheck=false;
    return;
  }
  state.manualUpdateCheck=false;
  const button=$('updateButton');button.hidden=false;
  const title=$('updateTitle'),action=$('updateAction');
  title.textContent=data.state==='ready'?'更新已下载':data.state==='downloading'?'正在下载更新':data.state==='error'?'检查更新失败':`发现雄霸AI ${data.version||''}`;
  $('updateNotes').textContent=data.notes||'此次更新的详细说明暂未获取。';
  $('updateDescription').textContent=data.state==='available'?'新版本已经发布，可以选择现在更新或稍后再说。':data.state==='downloading'?`正在下载 ${data.percent||0}%`:'你可以选择合适的时间安装。';
  action.textContent=data.state==='available'?'下载更新':data.state==='ready'?'安装并重启':data.state==='error'?'重试':'下载中…';
  action.disabled=data.state==='downloading';
  button.textContent=data.state==='ready'?'更新可安装':'发现新版本';
  if(['available','ready'].includes(data.state)&&!$('updateDialog').open&&!state.dismissedUpdateVersion?.includes(data.version))$('updateDialog').showModal();
  state.update=data;
}
function bind(){for(const [b,m] of [['modeButton','modeMenu'],['modelButton','modelMenu'],['ratioButton','ratioMenu'],['resolutionButton','resolutionMenu'],['durationButton','durationMenu']]){$(b).setAttribute('aria-controls',m);$(b).addEventListener('click',e=>{e.stopPropagation();toggleMenu($(b),$(m));});}
  document.addEventListener('click',e=>{if(!e.target.closest('.control'))hideMenus();});
  $('prompt').addEventListener('input',()=>{updateCount();const t=$('prompt');const before=t.value.slice(0,t.selectionStart);const match=before.match(/@([^\s@\n]*)$/);if(match)openMention(match[1]);else closeMenu($('mentionMenu'));});
  $('prompt').addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu($('mentionMenu'));if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();closeMenu($('mentionMenu'));send();}});
  $('expandPrompt').addEventListener('click',()=>$('composer').classList.toggle('expanded'));
  $('sendButton').addEventListener('click',send);
  $('addFile').addEventListener('click',async()=>{try{const found=await window.studio.chooseFiles();selectAdded(found);}catch(e){toast(e.message);}});
  for(const element of [document.body,$('composer')]){element.addEventListener('dragover',e=>{e.preventDefault();$('composer').classList.add('dragover');});element.addEventListener('dragleave',e=>{if(!e.relatedTarget?.closest?.('.composer'))$('composer').classList.remove('dragover');});element.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();$('composer').classList.remove('dragover');if(e.dataTransfer.files.length)addFiles([...e.dataTransfer.files]);});}
  $('settingsButton').addEventListener('click',()=>{$('baseUrl').value=state.settings?.baseUrl||'https://grsaiapi.com';$('settingsMessage').textContent='';$('settingsDialog').showModal();});$('closeSettings').addEventListener('click',()=>$('settingsDialog').close());$('cancelSettings').addEventListener('click',()=>$('settingsDialog').close());$('saveSettings').addEventListener('click',saveSettings);$('syncButton').addEventListener('click',async()=>{try{const r=await window.studio.syncModels();state.models=r.models;state.syncInfo=r.syncInfo;setMode(state.mode);updateConnection();toast(`已同步 ${r.models.length} 个模型`);}catch(e){toast(e.message);}});
  $('chatNav').addEventListener('click',()=>setView('chat'));$('historyNav').addEventListener('click',()=>setView('history'));$('newChat').addEventListener('click',()=>{state.conversationId=null;state.activeRecordIds.clear();state.welcomeGreeting=nextGreeting();setView('chat');$('prompt').focus();});$('clearHistory').addEventListener('click',async()=>{if(await window.studio.clearHistory()){state.history=[];state.activeRecordIds.clear();renderHistoryAndConversation();toast('历史已清空');}});
  $('closePreview').addEventListener('click',()=>$('previewDialog').close());$('previewDialog').addEventListener('close',()=>$('previewBody').replaceChildren());window.studio.onModels(data=>{state.models=data.models;state.syncInfo=data.syncInfo;setMode(state.mode);updateConnection();});window.studio.onHistory(data=>{const merged=[...data];for(const pending of state.pendingSubmissions){const real=data.find(r=>r.clientRequestId===pending.clientRequestId);if(real){state.activeRecordIds.delete(pending.localId);if(state.conversationId===real.conversationId)state.activeRecordIds.add(real.id);}else{const local=state.history.find(r=>r.id===pending.localId);if(local)merged.unshift(local);}}state.history=merged;renderHistoryAndConversation();});window.studio.onChatProgress(data=>{const record=state.history.find(r=>r.id===data.id);if(!record)return;Object.assign(record,data);const answer=[...document.querySelectorAll('.message.assistant')].find(x=>x.dataset.recordId===data.id);if(answer)updateTextAnswer(answer,record);$('conversation').scrollTop=$('conversation').scrollHeight;});window.studio.onNotice(toast);
  $('collapseSidebar').addEventListener('click',()=>{const collapsed=$('shell').classList.toggle('sidebar-collapsed');$('collapseSidebar').title=collapsed?'展开侧边栏':'收起侧边栏';$('collapseSidebar').setAttribute('aria-label',$('collapseSidebar').title);});$('gatewayEnter').addEventListener('click',enterGateway);for(const id of ['gatewayUrl','gatewayKey'])$(id).addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();enterGateway();}});
  $('submitApplication').addEventListener('click',async()=>{const button=$('submitApplication');button.disabled=true;try{const status=await window.studio.submitApplication({username:$('approvalUsername').value,password:$('approvalPassword').value});$('approvalPassword').value='';if(status.active)await enterLicensedWorkspace();else showActivation(status);}catch(error){$('activationMessage').textContent=error.message;}finally{button.disabled=false;}});
  $('refreshApplication').addEventListener('click',async()=>{try{const status=await window.studio.refreshApplication();if(status.active)await enterLicensedWorkspace();else showActivation(status);}catch(error){$('activationMessage').textContent=error.message;}});
  $('copyMachineCode').addEventListener('click',()=>window.studio.copyMachineCode().then(()=>toast('已复制机器码')).catch(error=>toast(error.message)));
  window.studio.onLicense(status=>{if(status.active&&$('activation').hidden===false)enterLicensedWorkspace().catch(error=>toast(error.message));else if(!status.active)showActivation(status);});
  window.studio.onWallpaper(applyWallpaper);window.studio.onUpdate(renderUpdate);
  $('checkConnection').addEventListener('click',checkConnection);
  $('closeDiagnostic').addEventListener('click',()=>$('diagnosticDialog').close());
  $('diagnosticClose').addEventListener('click',()=>$('diagnosticDialog').close());
  const opacity=$('wallpaperOpacity');opacity.value=localStorage.getItem('xiongba-wallpaper-opacity')||'24';$('wallpaperLayer').style.opacity=String(Number(opacity.value)/100);
  opacity.addEventListener('input',()=>{$('wallpaperLayer').style.opacity=String(Number(opacity.value)/100);localStorage.setItem('xiongba-wallpaper-opacity',opacity.value);});
  $('wallpaperButton').addEventListener('click',()=>{opacity.focus();opacity.classList.add('attention');setTimeout(()=>opacity.classList.remove('attention'),900);});
  $('checkUpdateButton').addEventListener('click',async()=>{state.manualUpdateCheck=true;const button=$('checkUpdateButton');button.disabled=true;button.textContent='检查中…';try{const result=await window.studio.checkUpdates();if(result?.message==='开发模式不检查更新'){state.manualUpdateCheck=false;button.disabled=false;button.textContent='检查更新';toast(result.message);}}catch(error){state.manualUpdateCheck=false;button.disabled=false;button.textContent='检查更新';toast(`检查更新失败：${error.message}`);}});
  $('updateButton').addEventListener('click',()=>$('updateDialog').showModal());$('closeUpdate').addEventListener('click',()=>$('updateDialog').close());$('updateLater').addEventListener('click',()=>$('updateDialog').close());$('updateDialog').addEventListener('close',()=>{state.dismissedUpdateVersion=state.update?.version;});
  $('updateAction').addEventListener('click',async()=>{try{if(state.update?.state==='available')await window.studio.downloadUpdate();else if(state.update?.state==='ready')await window.studio.installUpdate();else await window.studio.checkUpdates();}catch(error){toast(error.message);}});
}
(async()=>{state.welcomeGreeting=nextGreeting();bind();try{const data=await window.studio.init();applyWallpaper(data.wallpaper);if(data.license.active)await enterLicensedWorkspace();else showActivation(data.license);}catch(e){showActivation({message:`启动失败：${e.message}`});}})();
