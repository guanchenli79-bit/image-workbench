const {app,BrowserWindow,ipcMain,dialog,safeStorage,protocol,net,clipboard,nativeImage,Menu}=require('electron');
const {autoUpdater}=require('electron-updater');
const fsp=require('node:fs/promises');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const pdfParse=require('pdf-parse');
const mammoth=require('mammoth');
const {pathToFileURL}=require('node:url');
const {normalizeBase,requestChat,generateImage,generateVideo,queryTask}=require('./api.cjs');
const {syncModels,allowedFile}=require('./multimodal.cjs');
const {resolveSize}=require('./sizing.cjs');
const {presets}=require('./catalog.cjs');
const {networkFetch}=require('./network.cjs');
const {releaseNotesText}=require('./update-notes.cjs');
const {currentMachineCode,normalizeLicenseKey,hashCode,findLicense,fetchRegistry}=require('./license.cjs');
const {loadIdentity,submitApplication,getApplication}=require('./approval.cjs');
const {fetchManifest,downloadWallpaper,sha256}=require('./wallpapers.cjs');
const {cleanApiKey,planScenarios}=require('./diagnostics.cjs');

const legacyDataPath=path.join(app.getPath('appData'),'image-workbench');
fs.mkdirSync(legacyDataPath,{recursive:true});
app.setPath('userData',legacyDataPath);
protocol.registerSchemesAsPrivileged([
  {scheme:'preview-media',privileges:{secure:true,standard:true,supportFetchAPI:true,stream:true}},
  {scheme:'workbench-wallpaper',privileges:{secure:true,standard:true,supportFetchAPI:true,stream:true}}
]);
const DATA=app.getPath('userData');
const SETTINGS=path.join(DATA,'settings.json');
const HISTORY=path.join(DATA,'history.json');
const MEDIA=path.join(DATA,'temporary-media');
const WALLPAPER_STATE=path.join(DATA,'wallpaper-state.json');
const WALLPAPER_CACHE=path.join(DATA,'wallpaper-cache');
const TTL=2*60*60*1000;
const MAX_FILE=40*1024*1024;
const MIME={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.txt':'text/plain','.md':'text/markdown','.csv':'text/csv','.json':'application/json','.html':'text/html','.pdf':'application/pdf','.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime'};
let window;
let settings={baseUrl:'https://grsaiapi.com',apiKey:''};
let profiles={};
let models=[];
let syncInfo={status:'idle',source:''};
let files=new Map();
let history=[];
let conversations={};
let historyQueue=Promise.resolve();
let pollBusy=false;
let machineCode='';
let machineError='';
let deviceIdentity=null;
let approvalStatus={status:'none'};
let approvalCheckedAt=0;
let approvalReason='';
let legacyLicense=null;
let wallpaper={id:'original',kind:'bundled'};
let wallpaperSyncing=false;
let availableUpdate=false;
let updateReady=false;
let readyVersion='';
const emit=(channel,data)=>{if(window&&!window.isDestroyed())window.webContents.send(channel,data);};
function licenseStatus(){
  const now=Date.now();
  if(approvalStatus.status!=='none'){
    const active=approvalStatus.status==='approved'&&Date.parse(approvalStatus.expiresAt)>now&&now-approvalCheckedAt<5*60*1000;
    const labels={pending:'申请已提交，等待管理员审批',rejected:'申请已驳回，可重新提交',unbound:'设备已解绑，可重新申请',expired:'绑定已到期，请重新申请'};
    return {active,status:approvalStatus.status,machineCode,expiresAt:active?approvalStatus.expiresAt:null,name:approvalStatus.name||'',message:active?'已通过审批':approvalReason||labels[approvalStatus.status]||'请提交使用申请'};
  }
  const active=!!machineCode&&!!legacyLicense&&Date.parse(legacyLicense.expiresAt)>now&&now+5*60*1000>=Number(legacyLicense.lastSeenAt||0);
  return {active,status:active?'legacy':'none',machineCode,message:machineError||approvalReason||(active?'旧版授权有效':'填写用户名和密码向管理员提交申请')};
}
function requireLicense(){if(!licenseStatus().active)throw new Error(licenseStatus().message);}
async function refreshApproval(){
  if(!deviceIdentity||!machineCode)return;
  try{approvalStatus=await getApplication(deviceIdentity,machineCode);approvalCheckedAt=Date.now();approvalReason='';}
  catch(error){approvalReason=`审批服务暂不可用：${error.message}`;}
  emit('license:status',licenseStatus());
}
function wallpaperDescriptor(){return wallpaper.kind==='bundled'?{id:'original',kind:'video',url:'../../assets/activation-wallpaper.mp4'}:{id:wallpaper.id,kind:wallpaper.kind,url:`workbench-wallpaper://current/${path.basename(wallpaper.file)}`};}
async function loadCachedWallpaper(){try{const saved=JSON.parse(await fsp.readFile(WALLPAPER_STATE,'utf8'));if(saved.kind==='bundled')return;const file=path.join(WALLPAPER_CACHE,path.basename(saved.file||''));const bytes=await fsp.readFile(file);if(sha256(bytes)===saved.sha256)wallpaper={id:saved.id,kind:saved.kind,file,sha256:saved.sha256};}catch{}}
async function syncWallpaper(){if(wallpaperSyncing)return;wallpaperSyncing=true;try{const manifest=await fetchManifest();const selected=manifest.items.find(item=>item.id===manifest.activeId);if(!selected)return;const next=selected.kind==='bundled'?{id:'original',kind:'bundled'}:{id:selected.id,kind:selected.kind,file:await downloadWallpaper(selected,WALLPAPER_CACHE),sha256:selected.sha256};if(next.id!==wallpaper.id||next.sha256!==wallpaper.sha256){wallpaper=next;await writeJson(WALLPAPER_STATE,{...next,file:next.file?path.basename(next.file):undefined});emit('wallpaper:changed',wallpaperDescriptor());}}catch{}finally{wallpaperSyncing=false;}}
const publicSettings=()=>({baseUrl:settings.baseUrl,hasKey:!!settings.apiKey,keyTail:settings.apiKey.slice(-4)});
const publicHistory=()=>history.map(({localFiles,...r})=>({...r,media:(localFiles||[]).map((_,i)=>`preview-media://item/${r.id}/${i}`)}));
async function writeJson(file,value){const tmp=file+'.'+crypto.randomUUID()+'.tmp';await fsp.writeFile(tmp,JSON.stringify(value,null,2),'utf8');await fsp.rename(tmp,file);}
async function saveSettings(){if(settings.apiKey&&!safeStorage.isEncryptionAvailable())throw new Error('Windows 安全存储不可用，无法保存 API Key');profiles[settings.baseUrl]={apiKey:settings.apiKey,models,syncInfo};const stored={baseUrl:settings.baseUrl,profiles:{}};for(const [base,p] of Object.entries(profiles))stored.profiles[base]={key:p.apiKey?safeStorage.encryptString(p.apiKey).toString('base64'):'',models:p.models||[],syncInfo:p.syncInfo||{status:'idle'}};await writeJson(SETTINGS,stored);}
async function saveHistory(){const snapshot=JSON.parse(JSON.stringify({history,conversations}));historyQueue=historyQueue.catch(()=>{}).then(()=>writeJson(HISTORY,snapshot));await historyQueue;emit('history:changed',publicHistory());}
async function loadState(){
  await fsp.mkdir(MEDIA,{recursive:true});
  await loadCachedWallpaper();
  try{machineCode=await currentMachineCode();}catch(error){machineError=error.message;}
  try{deviceIdentity=await loadIdentity(app,safeStorage);}catch(error){approvalReason=error.message;}
  try{const saved=JSON.parse(await fsp.readFile(path.join(DATA,'license.json'),'utf8'));const decoded=safeStorage.decryptString(Buffer.from(saved.data,'base64'));const record=JSON.parse(decoded);if(record.machineHash===hashCode('machine',machineCode))legacyLicense=record;}catch{}
  try{
    const saved=JSON.parse(await fsp.readFile(SETTINGS,'utf8'));
    settings.baseUrl=normalizeBase(saved.baseUrl||saved.activeBaseUrl||settings.baseUrl);
    for(const [base,p] of Object.entries(saved.profiles||{})){
      try{
        const key=p.key||p.apiKey||'';
        const apiKey=key&&safeStorage.isEncryptionAvailable()?safeStorage.decryptString(Buffer.from(key,'base64')):'';
        const compatible=Array.isArray(p.models)&&p.models.every(m=>m.type&&typeof m.supported==='boolean');
        profiles[normalizeBase(base)]={apiKey,models:compatible?p.models:[],syncInfo:p.syncInfo||{status:'idle'}};
      }catch{}
    }
    if(!Object.keys(profiles).length&&(saved.key||saved.apiKey))profiles[settings.baseUrl]={apiKey:safeStorage.decryptString(Buffer.from(saved.key||saved.apiKey,'base64')),models:[],syncInfo:{status:'idle'}};
    const active=profiles[settings.baseUrl];if(active){settings.apiKey=active.apiKey;models=active.models;syncInfo=active.syncInfo;}
    if(Object.values(saved.profiles||{}).some(p=>p.apiKey&&!p.key))await fsp.copyFile(SETTINGS,path.join(DATA,'settings-before-xiongba.json'),fs.constants.COPYFILE_EXCL).catch(()=>{});
  }catch{}
  try{
    const saved=JSON.parse(await fsp.readFile(HISTORY,'utf8'));
    if(Array.isArray(saved)){
      await fsp.copyFile(HISTORY,path.join(DATA,'history-before-xiongba.json'),fs.constants.COPYFILE_EXCL).catch(()=>{});
      history=saved.map(r=>({...r,conversationId:r.conversationId||r.id,ratio:r.ratio||r.actualRatio||r.presetId||'auto',localFiles:r.files||[],resolution:r.resolution||'default'}));
      conversations={};
      await saveHistory();
    }else{history=Array.isArray(saved.history)?saved.history:[];conversations=saved.conversations||{};}
  }catch{}
  await expireMedia();
  await refreshApproval();
}
async function expireMedia(){let changed=false;for(const r of history){if(r.expiresAt&&Date.now()>=r.expiresAt&&r.status==='complete'){for(const name of r.localFiles||[])await fsp.rm(path.join(MEDIA,name),{force:true});r.localFiles=[];r.status='expired';changed=true;}}if(changed)await saveHistory();}
async function doSync(){const result=await syncModels(settings);models=result.models;syncInfo={status:'ok',source:result.source,at:Date.now(),provider:result.provider,authVerified:result.authVerified};await saveSettings();emit('models:changed',{models,syncInfo});return {models,syncInfo};}
function getModel(id){const model=models.find(x=>x.id===id);if(!model)throw new Error('请先同步并选择当前接口的模型');if(!model.supported)throw new Error(model.reason||'此模型需要接口适配');return model;}
function filePublic(item){return {id:item.id,name:item.name,kind:item.kind,mime:item.mime,size:item.buffer.length,preview:['image','video','audio'].includes(item.kind)?`preview-media://reference/${item.id}`:null};}
async function addFile(name,bytes){const safe=path.basename(String(name||''));const mime=MIME[path.extname(safe).toLowerCase()];if(!mime)throw new Error(`${safe} 的格式暂不支持`);const buffer=Buffer.from(bytes||[]);if(!buffer.length||buffer.length>MAX_FILE)throw new Error(`${safe} 必须小于 40 MB 且不能为空`);const kind=mime.startsWith('image/')?'image':mime.startsWith('video/')?'video':mime.startsWith('audio/')?'audio':'document';const item={id:crypto.randomUUID(),name:safe,mime,kind,buffer};if(mime==='application/pdf')item.text=(await pdfParse(buffer)).text;else if(mime.includes('wordprocessingml'))item.text=(await mammoth.extractRawText({buffer})).value;else if(kind==='document')item.text=buffer.toString('utf8');if(kind==='document'&&!item.text.trim())throw new Error(`${safe} 没有可提取的文字`);files.set(item.id,item);return filePublic(item);}
function selectedFiles(ids,model,weights={}){const picked=(ids||[]).map(id=>files.get(id)).filter(Boolean).map(item=>({...item,weight:Math.min(2,Math.max(.1,Number(weights[item.id])||1))}));if(picked.length>10)throw new Error('每次最多引用 10 个文件');for(const f of picked)if(!allowedFile(model,f))throw new Error(`${model.label} 的已确认能力不支持引用 ${f.name}`);return picked;}
function promptWithWeights(prompt,picked){const weighted=picked.map((f,i)=>({f,index:i+1})).filter(({f})=>Math.abs(f.weight-1)>.001);if(!weighted.length)return prompt;return `${prompt}\n\n参考素材重要程度（相对值，1.0 为默认）：${weighted.map(({f,index})=>`第 ${index} 个文件「${f.name}」${f.weight.toFixed(1)}`).join('；')}。请按此侧重参考，仍以文字要求为准。`;}
function textParts(prompt,picked){const parts=[{type:'text',text:prompt}];for(const f of picked){if(f.kind==='image')parts.push({type:'image_url',image_url:{url:`data:${f.mime};base64,${f.buffer.toString('base64')}`}});else if(f.kind==='document'){const content=f.text;if(content.length>100000)throw new Error(`${f.name} 内容过长，请拆分文档`);parts.push({type:'text',text:`\n[文件：${f.name}]\n${content}\n[/文件]`});}}return parts;}
async function chat(input,model,picked){
  const conversationId=String(input.conversationId||crypto.randomUUID());
  const previous=Array.isArray(conversations[conversationId])?conversations[conversationId].slice(-40):[];
  const content=textParts(promptWithWeights(input.prompt,picked),picked);
  const messages=[...previous.map(m=>({role:m.role,content:m.content})),{role:'user',content}];
  const record={id:crypto.randomUUID(),clientRequestId:input.clientRequestId||'',conversationId,type:'text',modelId:model.id,modelName:model.label,prompt:input.prompt,answer:'',reasoning:'',createdAt:Date.now(),status:'thinking',localFiles:[]};
  history.unshift(record);await saveHistory();
  let lastEmit=0;
  const progress=({answer='',reasoning=''})=>{
    record.answer=answer.slice(0,120000);record.reasoning=reasoning.slice(0,60000);
    record.status=answer?'responding':'thinking';
    if(Date.now()-lastEmit>70){emit('chat:progress',{id:record.id,answer:record.answer,reasoning:record.reasoning,status:record.status});lastEmit=Date.now();}
  };
  try{
    const result=await requestChat(settings,model.id,messages,progress);
    record.answer=result.answer||record.answer;
    record.reasoning=result.reasoning||record.reasoning;
    if(!record.answer)throw new Error('接口没有返回文本内容；此模型可能需要专用协议');
    let retained=[...previous,{role:'user',content:content.filter(part=>part.type==='text')},{role:'assistant',content:record.answer}].slice(-40);
    while(retained.length>2&&JSON.stringify(retained).length>120000)retained=retained.slice(2);
    conversations[conversationId]=retained;
    record.status='complete';await saveHistory();return {conversationId,record};
  }catch(error){record.status='failed';record.error=error.message;await saveHistory();throw error;}
}
async function downloadResult(item,type,taskSettings){
  if(item.b64)return Buffer.from(String(item.b64).replace(/^data:[^,]+,/i,''),'base64');
  const url=new URL(item.url);if(url.protocol!=='https:'&&!(['localhost','127.0.0.1'].includes(url.hostname)&&url.protocol==='http:'))throw new Error('结果文件地址不安全');
  const sameOrigin=url.origin===new URL(taskSettings.baseUrl).origin;
  const response=await networkFetch(url,{headers:sameOrigin?{Authorization:'Bearer '+taskSettings.apiKey}:{},signal:AbortSignal.timeout(type==='video'?240000:90000)});
  if(!response.ok)throw new Error(`下载生成结果失败：HTTP ${response.status}`);
  const data=Buffer.from(await response.arrayBuffer());if(data.length>(type==='video'?512:40)*1024*1024)throw new Error('生成结果超出本地缓存限制');return data;
}
async function finishRecord(record,items,taskSettings){const localFiles=[];for(const [i,item] of items.entries()){const data=await downloadResult(item,record.type,taskSettings);const ext=record.type==='video'?'.mp4':data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'.png':data[0]===255?'.jpg':'.webp';const name=`${record.id}-${i}${ext}`;await fsp.writeFile(path.join(MEDIA,name),data);localFiles.push(name);}record.localFiles=localFiles;record.status='complete';record.progress=100;record.expiresAt=Date.now()+TTL;await saveHistory();}
async function poll(){if(pollBusy)return;pollBusy=true;try{await Promise.allSettled(history.filter(x=>x.status==='pending'&&x.taskId).map(async r=>{try{const profile=profiles[r.baseUrl];if(!profile?.apiKey)throw new Error('原接口的 Key 已移除，暂时无法查询任务');const taskSettings={baseUrl:r.baseUrl,apiKey:profile.apiKey};const result=await queryTask(taskSettings,r.taskAdapter,r.taskId,r.type);if(result.status==='complete')await finishRecord(r,result.items,taskSettings);else if(result.status==='failed'){r.status='failed';r.error=result.error;await saveHistory();}else if(result.progress!==r.progress){r.progress=result.progress;await saveHistory();}}catch(error){r.pollError=error.message;await saveHistory();}}));}finally{pollBusy=false;}}
async function generate(input,model,picked){
  const sizing=resolveSize(model,input.presetId||'auto',input.prompt,input.referenceDimensions,input.resolutionId);
  const taskSettings={...settings};
  const conversationId=String(input.conversationId||crypto.randomUUID());
  const record={id:crypto.randomUUID(),clientRequestId:input.clientRequestId||'',conversationId,type:model.type,baseUrl:taskSettings.baseUrl,modelId:model.id,modelName:model.label,prompt:input.prompt,ratio:sizing.ratio,resolution:sizing.resolution,seconds:model.type==='video'?Number(input.seconds):null,createdAt:Date.now(),status:'submitting',progress:0,localFiles:[]};history.unshift(record);await saveHistory();
  try{
    const refs=picked.map(f=>({name:f.name,kind:f.kind,mime:f.mime,buffer:f.buffer,weight:f.weight}));
    const weightedPrompt=promptWithWeights(input.prompt,picked);
    const result=model.type==='image'?await generateImage(taskSettings,{prompt:weightedPrompt},model,sizing,refs):await generateVideo(taskSettings,{prompt:weightedPrompt,seconds:input.seconds},model,sizing,refs);
    if(result.kind==='complete')await finishRecord(record,result.items,taskSettings);
    else{record.status='pending';record.taskId=result.taskId;record.taskAdapter=result.taskAdapter;await saveHistory();setTimeout(poll,1400);}
    return {id:record.id,conversationId};
  }catch(error){record.status='failed';record.error=error.message;await saveHistory();throw error;}
}
async function copyImageRecord(id,index){
  requireLicense();
  const record=history.find(item=>item.id===id&&item.type==='image'&&item.status==='complete'&&Date.now()<item.expiresAt);
  const number=Number(index);
  const name=Number.isInteger(number)&&number>=0?record?.localFiles?.[number]:null;
  if(!name)throw new Error('图片已过期或不存在，请重新生成后再复制');
  const bytes=await fsp.readFile(path.join(MEDIA,name));
  let source=nativeImage.createFromBuffer(bytes);
  if(source.isEmpty()&&path.extname(name).toLowerCase()==='.webp'){
    const dataUrl=`data:image/webp;base64,${bytes.toString('base64')}`;
    const pngUrl=await window.webContents.executeJavaScript(`new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);resolve(canvas.toDataURL('image/png'));};image.onerror=()=>reject(new Error('无法解码 WebP 原图'));image.src=${JSON.stringify(dataUrl)};})`);
    source=nativeImage.createFromDataURL(pngUrl);
  }
  if(source.isEmpty())throw new Error('无法解码原图，请先使用“保存原文件”');
  clipboard.writeImage(source);
  const copied=clipboard.readImage();
  const size=source.getSize(),pastedSize=copied.getSize();
  if(copied.isEmpty()||size.width!==pastedSize.width||size.height!==pastedSize.height)
    throw new Error('系统剪切板未确认收到完整图片，请重试或先保存原文件');
  return {width:size.width,height:size.height};
}
async function inspectConnection(input){
  requireLicense();
  const suppliedUrl=String(input?.baseUrl||settings.baseUrl).trim();
  const baseUrl=normalizeBase(suppliedUrl);
  const savedKey=profiles[baseUrl]?.apiKey||(baseUrl===settings.baseUrl?settings.apiKey:'');
  const {token,removedBearer}=cleanApiKey(String(input?.apiKey||'').trim()||savedKey);
  const repairs=[];
  if(baseUrl!==suppliedUrl.replace(/\/+$/,''))repairs.push('检查出接口地址含多余路径；正在修复为基础地址');
  if(removedBearer)repairs.push('检查出 API Key 含多余的 Bearer 前缀；正在修复输入格式');
  const result=await syncModels({baseUrl,apiKey:token});
  if(baseUrl===settings.baseUrl&&token===settings.apiKey){
    const oldIds=models.map(item=>item.id).join('|');
    if(oldIds!==result.models.map(item=>item.id).join('|')){
      models=result.models;
      syncInfo={status:'ok',source:result.source,at:Date.now(),provider:result.provider,authVerified:result.authVerified};
      await saveSettings();
      emit('models:changed',{models,syncInfo});
      repairs.push('检查出本机模型列表已过期；正在修复并同步最新模型');
    }
  }
  return {baseUrl,removedBearer,repairs,authVerified:result.authVerified,source:result.source,
    modelCount:result.models.length,scenarios:planScenarios(result.models)};
}
function createWindow(){window=new BrowserWindow({width:1450,height:900,minWidth:1040,minHeight:680,backgroundColor:'#f8f6f2',title:'雄霸AI',icon:path.join(__dirname,'..','assets','logo.ico'),autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'multimodal-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});window.loadFile(path.join(__dirname,'renderer','index.html'));window.webContents.on('context-menu',(_,p)=>{if(!licenseStatus().active||p.mediaType!=='image'||!p.srcURL.startsWith('preview-media://item/'))return;const url=new URL(p.srcURL);const [id,index]=url.pathname.split('/').filter(Boolean);Menu.buildFromTemplate([{label:'复制原图',click:()=>copyImageRecord(id,index).then(({width,height})=>emit('notice',`已复制原图 ${width} × ${height}`)).catch(error=>emit('notice',error.message))}]).popup({window});});}
function registerIpc(){
  ipcMain.handle('init',()=>({license:licenseStatus(),wallpaper:wallpaperDescriptor(),version:app.getVersion(),settings:publicSettings(),models:licenseStatus().active?models:[],syncInfo,history:licenseStatus().active?publicHistory():[],files:licenseStatus().active?[...files.values()].map(filePublic):[],presets}));
  ipcMain.handle('approval:submit',async(_,input)=>{if(!deviceIdentity||!machineCode)throw new Error(approvalReason||machineError||'设备身份不可用');approvalStatus=await submitApplication(deviceIdentity,machineCode,String(input?.username||'').trim(),String(input?.password||''));approvalCheckedAt=Date.now();emit('license:status',licenseStatus());return licenseStatus();});
  ipcMain.handle('approval:refresh',async()=>{await refreshApproval();return licenseStatus();});
  ipcMain.handle('license:copy-machine',()=>{if(!machineCode)throw new Error(machineError||'机器码不可用');clipboard.writeText(machineCode);return true;});
  ipcMain.handle('settings:save',async(_,data)=>{requireLicense();const baseUrl=normalizeBase(data.baseUrl);const profile=profiles[baseUrl]||{};const apiKey=cleanApiKey(String(data.apiKey||'').trim()||profile.apiKey||'').token;settings={baseUrl,apiKey};models=profile.models||[];syncInfo=profile.syncInfo||{status:'idle',source:''};await saveSettings();try{return {settings:publicSettings(),...await doSync()};}catch(error){return {settings:publicSettings(),models,syncInfo,error:error.message};}});
  ipcMain.handle('models:sync',async()=>{requireLicense();return doSync();});
  ipcMain.handle('diagnostics:check',(_,input)=>inspectConnection(input));
  ipcMain.handle('files:choose',async()=>{requireLicense();const chosen=await dialog.showOpenDialog(window,{properties:['openFile','multiSelections'],filters:[{name:'参考文件',extensions:Object.keys(MIME).map(x=>x.slice(1))}]});if(chosen.canceled)return [];return Promise.all(chosen.filePaths.map(async p=>addFile(p,await fsp.readFile(p))));});
  ipcMain.handle('files:add',(_,items)=>{requireLicense();return Promise.all(items.map(x=>addFile(x.name,x.bytes)));});
  ipcMain.handle('files:remove',(_,id)=>{requireLicense();return files.delete(id);});
  ipcMain.handle('files:preview',(_,id)=>{requireLicense();const item=files.get(id);if(!item||item.kind!=='document')throw new Error('参考文件已失效');return item.text.slice(0,100000);});
  ipcMain.handle('submit',async(_,input)=>{requireLicense();if(!settings.apiKey)throw new Error('请先设置 API Key');const model=getModel(input.modelId);if(model.type!==input.type)throw new Error('模型与模式不匹配');const prompt=String(input.prompt||'').trim();if(!prompt)throw new Error('请输入内容');if(prompt.length>8000)throw new Error('内容不能超过 8000 字');const picked=selectedFiles(input.fileIds,model,input.referenceWeights);if(model.requiredRefs&&!picked.length)throw new Error('此模型需要参考文件');return model.type==='text'?chat({...input,prompt},model,picked):generate({...input,prompt},model,picked);});
  ipcMain.handle('history:list',()=>{requireLicense();return publicHistory();});
  ipcMain.handle('clipboard:write-text',(_,value)=>{requireLicense();clipboard.writeText(String(value||''));return true;});
  ipcMain.handle('history:copy-image',(_,id,index)=>copyImageRecord(id,index));
  ipcMain.handle('history:save',async(_,id,index)=>{requireLicense();const r=history.find(x=>x.id===id);const name=r?.localFiles?.[index];if(!name)throw new Error('生成文件已过期');const chosen=await dialog.showSaveDialog(window,{defaultPath:name});if(chosen.canceled)return false;await fsp.copyFile(path.join(MEDIA,name),chosen.filePath);return true;});
  ipcMain.handle('history:clear',async()=>{requireLicense();const result=await dialog.showMessageBox(window,{type:'warning',message:'清空本机历史记录？',buttons:['取消','清空'],defaultId:0,cancelId:0});if(result.response!==1)return false;for(const r of history)for(const name of r.localFiles||[])await fsp.rm(path.join(MEDIA,name),{force:true});history=[];conversations={};await saveHistory();return true;});
  ipcMain.handle('updates:check',async()=>{if(!app.isPackaged)return {message:'开发模式不检查更新'};await autoUpdater.checkForUpdates();return {message:'正在检查更新'};});
  ipcMain.handle('updates:download',async()=>{if(!app.isPackaged||!availableUpdate)throw new Error('当前没有可下载的新版本');await autoUpdater.downloadUpdate();return {message:'更新已下载'};});
  ipcMain.handle('updates:install',()=>{if(!app.isPackaged||!updateReady)throw new Error('更新尚未下载完成');autoUpdater.quitAndInstall(false,true);});
}
app.whenReady().then(async()=>{
  await loadState();
  protocol.handle('preview-media',async request=>{
    if(!licenseStatus().active)return new Response('Not licensed',{status:403});
    const u=new URL(request.url);
    if(u.hostname==='reference'){
      const item=files.get(u.pathname.slice(1));if(!item)return new Response('Not found',{status:404});
      const size=item.buffer.length,range=request.headers.get('range'),match=/^bytes=(\d*)-(\d*)$/.exec(range||'');
      const start=match?(match[1]?Number(match[1]):Math.max(0,size-Number(match[2]))):0;
      const end=match?(match[1]?(match[2]?Math.min(size-1,Number(match[2])):size-1):size-1):size-1;
      if(start>=size||end<start)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
      const bytes=item.buffer.subarray(start,end+1);
      return new Response(bytes,{status:match?206:200,headers:{'Content-Type':item.mime,'Content-Length':String(bytes.length),'Accept-Ranges':'bytes',...(match?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})}});
    }
    const [id,i]=u.pathname.split('/').filter(Boolean);
    const r=history.find(x=>x.id===id&&x.status==='complete'&&Date.now()<x.expiresAt);
    const name=r?.localFiles?.[Number(i)];
    return name?net.fetch(pathToFileURL(path.join(MEDIA,name)).toString()):new Response('Not found',{status:404});
  });
  protocol.handle('workbench-wallpaper',async request=>{
    const u=new URL(request.url);
    if(u.hostname!=='current'||wallpaper.kind==='bundled'||u.pathname!==`/${path.basename(wallpaper.file)}`)return new Response('Not found',{status:404});
    const range=request.headers.get('range');
    return net.fetch(pathToFileURL(wallpaper.file).toString(),{headers:range&&/^bytes=\d*-\d*$/.test(range)?{Range:range}:{}});
  });
  registerIpc();createWindow();
  setInterval(poll,15000);setInterval(expireMedia,60000);
  setTimeout(syncWallpaper,1200);setInterval(syncWallpaper,75*1000);
  setInterval(refreshApproval,30*1000);
  if(licenseStatus().active&&settings.apiKey)setTimeout(()=>doSync().catch(()=>{}),800);
  if(app.isPackaged){
    autoUpdater.autoDownload=false;autoUpdater.autoInstallOnAppQuit=false;autoUpdater.fullChangelog=true;
    autoUpdater.on('checking-for-update',()=>emit('update:status',{state:'checking'}));
    autoUpdater.on('update-available',info=>{availableUpdate=true;updateReady=false;readyVersion='';emit('update:status',{state:'available',version:info.version,notes:releaseNotesText(info.releaseNotes)});});
    autoUpdater.on('update-not-available',()=>emit('update:status',{state:'current'}));
    autoUpdater.on('download-progress',progress=>emit('update:status',{state:'downloading',percent:Math.round(progress.percent)}));
    autoUpdater.on('update-downloaded',info=>{updateReady=true;readyVersion=info.version;emit('update:status',{state:'ready',version:info.version,notes:releaseNotesText(info.releaseNotes)});});
    autoUpdater.on('error',error=>emit('update:status',{state:'error',message:error.message}));
    setTimeout(()=>autoUpdater.checkForUpdates().catch(()=>{}),7000);
    setInterval(()=>autoUpdater.checkForUpdates().catch(()=>{}),30*60*1000);
  }
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
