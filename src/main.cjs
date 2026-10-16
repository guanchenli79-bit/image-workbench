const { app, BrowserWindow, ipcMain, dialog, safeStorage, protocol, net, shell, Menu, clipboard, ClipboardItem, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { imageModels, videoModels, presets } = require('./catalog.cjs');
const { resolveSize } = require('./sizing.cjs');
const { normalizeBase, requestJson, generateImage, generateVideo, queryTask } = require('./api.cjs');
const { networkFetch } = require('./network.cjs');
const { recoverSubmittedMidjourney } = require('./recovery.cjs');
const { releaseNotesText } = require('./update-notes.cjs');
const { prepareReference, MAX_REFERENCES } = require('./references.cjs');

protocol.registerSchemesAsPrivileged([{scheme:'workbench-media',privileges:{secure:true,standard:true,supportFetchAPI:true,stream:true}}]);

let mainWindow;
let records = [];
let settings = {baseUrl:'https://www.geeknow.top',apiKey:''};
const refs = new Map();
const TTL = 2 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
let polling = false;
let historyEpoch = 0;
let historyPersistQueue = Promise.resolve();
let availableUpdate = false;
let updateReady = false;
let readyVersion = null;

function files() {
  const dir = app.getPath('userData');
  return {dir, settings:path.join(dir,'settings.json'),history:path.join(dir,'history.json'),media:path.join(dir,'temporary-media')};
}
async function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fsp.writeFile(tmp,JSON.stringify(data,null,2),'utf8');
  await fsp.rename(tmp,file);
}
function encrypted(value) {
  if (!value) return '';
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储暂不可用，API Key 未保存');
  return safeStorage.encryptString(value).toString('base64');
}
function decrypted(value) {
  if (!value) return '';
  if (!safeStorage.isEncryptionAvailable()) return '';
  try { return safeStorage.decryptString(Buffer.from(value,'base64')); } catch { return ''; }
}
async function loadState() {
  const p = files();
  await fsp.mkdir(p.media,{recursive:true});
  try { const stored=JSON.parse(await fsp.readFile(p.settings,'utf8')); settings={baseUrl:normalizeBase(stored.baseUrl),apiKey:decrypted(stored.apiKey)}; } catch {}
  try { records=JSON.parse(await fsp.readFile(p.history,'utf8')); if(!Array.isArray(records))records=[]; } catch { records=[]; }
  if(recoverSubmittedMidjourney(records))await persistRecords();
  await pruneExpired();
}
async function persistSettings() {
  await writeJson(files().settings,{baseUrl:settings.baseUrl,apiKey:encrypted(settings.apiKey)});
}
function publicSettings() { return {baseUrl:settings.baseUrl,hasKey:!!settings.apiKey,keyTail:settings.apiKey?settings.apiKey.slice(-4):''}; }
function storeReferences(inputs) {
  if (!Array.isArray(inputs) || !inputs.length) return [];
  if (inputs.length + refs.size > MAX_REFERENCES) throw new Error(`参考图最多支持 ${MAX_REFERENCES} 张，请先移除多余图片`);
  const prepared = inputs.map(input=>prepareReference(input.name,input.bytes));
  return prepared.map(({buffer,mime,name})=>{
    const id=crypto.randomUUID();
    refs.set(id,{buffer,mime,name,addedAt:Date.now()});
    return {id,name,preview:`data:${mime};base64,${buffer.toString('base64')}`};
  });
}
function emit(channel,value) { if(mainWindow && !mainWindow.isDestroyed())mainWindow.webContents.send(channel,value); }
async function persistRecords() {
  const snapshot=JSON.parse(JSON.stringify(records));
  historyPersistQueue=historyPersistQueue.catch(()=>{}).then(()=>writeJson(files().history,snapshot));
  await historyPersistQueue;
  emit('history:changed',listHistory());
}
function listHistory() { return records.map(({files:mediaFiles,...rest})=>({...rest,media:mediaFiles?.map((_,i)=>`workbench-media://item/${rest.id}/${i}`)||[]})); }

function availableMedia(id,index) {
  const record=records.find(x=>x.id===id && x.status==='complete' && Date.now()<x.expiresAt);
  const name=Number.isInteger(index) && index>=0 ? record?.files?.[index] : null;
  if(!name)throw new Error('生成文件已过期或不存在，请重新生成');
  return {record,file:path.join(files().media,name)};
}
async function saveResult(id,index) {
  const {record,file}=availableMedia(id,index);
  const ext=path.extname(file);
  const chosen=await dialog.showSaveDialog(mainWindow,{title:'永久保存作品',defaultPath:`${record.modelId}-${new Date(record.createdAt).toISOString().slice(0,10)}${ext}`,filters:[{name:record.type==='video'?'视频':'图片',extensions:[ext.slice(1)]}]});
  if(chosen.canceled)return false;
  await fsp.copyFile(file,chosen.filePath);return true;
}
async function copyImage(id,index) {
  const {record,file}=availableMedia(id,index);
  if(record.type!=='image')throw new Error('仅图片支持复制到剪贴板');
  const original=await fsp.readFile(file);
  const image=nativeImage.createFromBuffer(original);
  if(image.isEmpty())throw new Error('此图片格式无法复制，请保存原文件');
  const png=original.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?original:image.toPNG();
  await clipboard.write([new ClipboardItem({'image/png':new Blob([png],{type:'image/png'})})]);
  emit('app:notice','图像已复制，保留原始尺寸与比例，可直接粘贴');
}

async function pruneExpired() {
  let changed=false;
  for (const r of records) {
    if (r.expiresAt && Date.now() >= r.expiresAt && r.status !== 'expired') {
      for (const name of r.files||[]) await fsp.rm(path.join(files().media,name),{force:true}).catch(()=>{});
      r.files=[]; r.status='expired'; changed=true;
    }
  }
  if (changed) await persistRecords();
}

function extension(mime,type,buffer) {
  if(type==='video') return '.mp4';
  if(buffer?.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return '.png';
  if(buffer?.[0]===255 && buffer?.[1]===216)return '.jpg';
  if(buffer?.toString('ascii',0,4)==='RIFF' && buffer?.toString('ascii',8,12)==='WEBP')return '.webp';
  if(mime==='image/jpeg')return '.jpg';
  if(mime==='image/webp')return '.webp';
  return '.png';
}
async function resultBuffer(settingsSnapshot,item,type) {
  if (item.b64) return Buffer.from(item.b64.replace(/^data:[^,]+,/i,''),'base64');
  if (!item.url) throw new Error('生成结果缺少文件地址');
  const url = new URL(item.url);
  if(url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname)))throw new Error('生成文件地址不安全');
  const sameOrigin = url.origin === new URL(normalizeBase(settingsSnapshot.baseUrl)).origin;
  const response = await networkFetch(url,{headers:sameOrigin?{Authorization:`Bearer ${settingsSnapshot.apiKey}`}:{},signal:AbortSignal.timeout(type==='video'?240000:90000)});
  if(!response.ok)throw new Error(`下载生成结果失败（HTTP ${response.status}）`);
  const limit=type==='video'?MAX_VIDEO_BYTES:MAX_IMAGE_BYTES;
  const size=Number(response.headers.get('content-length')||0);
  if(size>limit)throw new Error('生成文件超过本地缓存大小限制');
  const chunks=[];let total=0;
  for await (const chunk of response.body) { total+=chunk.length; if(total>limit)throw new Error('生成文件超过本地缓存大小限制'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}
async function completeRecord(record,items,settingsSnapshot) {
  const names=[];
  const epoch=historyEpoch;
  const active=()=>epoch===historyEpoch&&records.includes(record);
  try {
    for(let i=0;i<items.length;i++) {
      if(!active())throw new Error('任务已从历史中清除');
      const buffer=await resultBuffer(settingsSnapshot,items[i],record.type);
      if(!active())throw new Error('任务已从历史中清除');
      const name=`${record.id}-${i}${extension(items[i].mime,record.type,buffer)}`;
      await fsp.writeFile(path.join(files().media,name),buffer);
      names.push(name);
    }
    if(!active())throw new Error('任务已从历史中清除');
    record.files=names; record.status='complete'; record.progress=100;
    record.completedAt=Date.now(); record.expiresAt=record.completedAt+TTL;
    await persistRecords();
  } catch (error) {
    for(const name of names)await fsp.rm(path.join(files().media,name),{force:true}).catch(()=>{});
    throw error;
  }
}

async function pollTasks() {
  if(polling || !settings.apiKey)return;
  polling=true;
  try {
    const pending=records.filter(r=>r.status==='pending' && r.taskId);
    await Promise.allSettled(pending.map(async record=>{
      try {
        const result=await queryTask(settings,record.taskAdapter,record.taskId,record.type);
        if(!records.includes(record))return;
        if(result.status==='complete') await completeRecord(record,result.items,{...settings});
        else if(result.status==='failed') {record.status='failed';record.error=result.error;await persistRecords();}
        else if(record.progress!==result.progress) {record.progress=result.progress;await persistRecords();}
      } catch(error) { if(records.includes(record)){record.lastPollError=error.message;await persistRecords();} }
    }));
  } finally {polling=false;}
}

function createWindow() {
  mainWindow=new BrowserWindow({width:1440,height:900,minWidth:1050,minHeight:700,backgroundColor:'#f5f6f8',title:'画境工作台',icon:path.join(__dirname,'..','assets','logo.ico'),autoHideMenuBar:true,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  mainWindow.loadFile(path.join(__dirname,'renderer','index.html'));
  mainWindow.webContents.setWindowOpenHandler(({url})=>{ if(url.startsWith('https://docs.geeknow.ai/'))shell.openExternal(url); return {action:'deny'}; });
  mainWindow.webContents.on('context-menu',(_,params)=>{
    if(params.mediaType!=='image')return;
    let url;try{url=new URL(params.srcURL);}catch{return;}
    if(url.protocol!=='workbench-media:' || url.hostname!=='item')return;
    const [id,indexRaw]=url.pathname.split('/').filter(Boolean);
    if(!/^[0-9a-f-]{36}$/.test(id||'') || !/^\d+$/.test(indexRaw||''))return;
    const index=Number(indexRaw);
    const run=action=>()=>action(id,index).catch(error=>emit('app:notice',error.message));
    Menu.buildFromTemplate([
      {label:'复制图像（原尺寸）',click:run(copyImage)},
      {label:'保存原图到电脑…',click:run(saveResult)}
    ]).popup({window:mainWindow});
  });
}

function registerIpc() {
  ipcMain.handle('app:init',async()=>({settings:publicSettings(),imageModels,videoModels,presets,history:listHistory(),version:app.getVersion(),isPackaged:app.isPackaged}));
  ipcMain.handle('settings:save',async(_,input)=>{
    const baseUrl=normalizeBase(input.baseUrl);
    const apiKey=String(input.apiKey||'').trim();
    if(apiKey && !safeStorage.isEncryptionAvailable())throw new Error('系统安全存储不可用，无法保存 API Key');
    settings.baseUrl=baseUrl;
    if(apiKey)settings.apiKey=apiKey;
    if(input.clearKey)settings.apiKey='';
    await persistSettings(); return publicSettings();
  });
  ipcMain.handle('settings:verify',async(_,input)=>{
    const candidate={baseUrl:normalizeBase(input.baseUrl),apiKey:String(input.apiKey||'').trim()||settings.apiKey};
    if(!candidate.apiKey)throw new Error('请先输入 API Key');
    const data=await requestJson(candidate,'/v1/models',{method:'GET',signal:AbortSignal.timeout(25000)});
    return {ok:true,modelCount:Array.isArray(data?.data)?data.data.length:null};
  });
  ipcMain.handle('size:resolve',async(_,input)=>{const model=[...imageModels,...videoModels].find(x=>x.id===input.modelId);return model?resolveSize(model,input.presetId,input.prompt,input.referenceDimensions):null;});
  ipcMain.handle('reference:choose',async()=>{
    const picked=await dialog.showOpenDialog(mainWindow,{title:'选择参考图',properties:['openFile','multiSelections'],filters:[{name:'图片',extensions:['png','jpg','jpeg','webp']}]});
    if(picked.canceled)return [];
    if(picked.filePaths.length+refs.size>MAX_REFERENCES)throw new Error(`参考图最多支持 ${MAX_REFERENCES} 张，请先移除多余图片`);
    const inputs=await Promise.all(picked.filePaths.map(async file=>({name:path.basename(file),bytes:await fsp.readFile(file)})));
    return storeReferences(inputs);
  });
  ipcMain.handle('reference:add',async(_,inputs)=>storeReferences(inputs));
  ipcMain.handle('reference:clear',async(_,ids)=>{for(const id of ids||[])refs.delete(id);});
  ipcMain.handle('generate',async(_,input)=>{
    await pruneExpired();
    const type=input.type==='video'?'video':'image';
    const model=(type==='video'?videoModels:imageModels).find(x=>x.id===input.modelId);
    if(!model)throw new Error('请选择可用模型');
    const prompt=String(input.prompt||'').trim();if(!prompt)throw new Error('请填写提示词');
    if(prompt.length>8000)throw new Error('提示词过长');
    const references=(input.referenceIds||[]).map(id=>refs.get(id)).filter(Boolean);
    if(references.length>10)throw new Error('参考图最多支持 10 张');
    if(references.length && !model.refs)throw new Error('该模型不支持参考图');
    if(model.requiredRefs && !references.length)throw new Error('该模型需要至少一张参考图');
    const sizing=resolveSize(model,input.presetId,prompt,input.referenceDimensions);
    const snapshot={...settings};
    const record={id:crypto.randomUUID(),type,modelId:model.id,modelName:model.label,prompt,presetId:input.presetId,actualRatio:sizing.ratio,actualSize:sizing.size,status:'submitting',progress:0,createdAt:Date.now(),files:[]};
    records.unshift(record);await persistRecords();
    try {
      const result=type==='image'?await generateImage(snapshot,{prompt},model,sizing,references):await generateVideo(snapshot,{prompt,seconds:input.seconds},model,sizing,references);
      if(!records.includes(record))return {id:record.id,status:'cleared'};
      if(result.kind==='complete')await completeRecord(record,result.items,snapshot);
      else {record.status='pending';record.taskId=result.taskId;record.taskAdapter=result.taskAdapter;await persistRecords();setTimeout(pollTasks,1500);}
      return {id:record.id,status:record.status};
    } catch(error) {if(!records.includes(record))return {id:record.id,status:'cleared'};record.status='failed';record.error=error.message;await persistRecords();throw error;}
  });
  ipcMain.handle('history:list',async()=>{await pruneExpired();return listHistory();});
  ipcMain.handle('history:clear',async()=>{
    const count=records.length;
    if(count){
      const {response}=await dialog.showMessageBox(mainWindow,{type:'warning',title:'清空历史任务？',message:`确定清空全部 ${count} 条历史任务吗？`,detail:'未另存的本机临时图片和视频会一起删除，无法恢复。正在生成的服务端任务可能继续运行。',buttons:['取消','清空历史'],defaultId:0,cancelId:0,noLink:true});
      if(response!==1)return {cleared:false,count:0};
    }
    historyEpoch++;
    records=[];
    await persistRecords();
    const mediaDir=files().media;
    for(const entry of await fsp.readdir(mediaDir,{withFileTypes:true})){
      if(entry.isFile())await fsp.rm(path.join(mediaDir,entry.name),{force:true});
    }
    return {cleared:true,count};
  });
  ipcMain.handle('history:save',async(_,id,index)=>saveResult(id,index));
  ipcMain.handle('updates:check',async()=>{if(!app.isPackaged)return {message:'开发模式不检查更新'};await autoUpdater.checkForUpdates();return {message:'正在检查更新'};});
  ipcMain.handle('updates:download',async()=>{if(!app.isPackaged||!availableUpdate)throw new Error('当前没有可下载的新版本');await autoUpdater.downloadUpdate();return {message:'更新已下载'};});
  ipcMain.handle('updates:install',()=>{if(!app.isPackaged||!updateReady)throw new Error('更新尚未下载完成');autoUpdater.quitAndInstall(false,true);});
}

app.whenReady().then(async()=>{
  await loadState();
  protocol.handle('workbench-media',async request=>{
    const url=new URL(request.url);
    const [id,indexRaw]=url.pathname.split('/').filter(Boolean);
    if(url.hostname!=='item'||!/^[0-9a-f-]{36}$/.test(id||'')||!/^[0-9]+$/.test(indexRaw||''))return new Response('Not found',{status:404});
    const record=records.find(x=>x.id===id && x.status==='complete' && Date.now()<x.expiresAt);
    const name=record?.files?.[Number(indexRaw)];
    if(!name)return new Response('Expired',{status:404});
    return net.fetch(pathToFileURL(path.join(files().media,name)).toString());
  });
  registerIpc();createWindow();
  setInterval(pruneExpired,60*1000);setInterval(pollTasks,15*1000);setTimeout(pollTasks,2000);
  if(app.isPackaged){
    autoUpdater.autoDownload=false;autoUpdater.autoInstallOnAppQuit=false;
    autoUpdater.fullChangelog=true;
    autoUpdater.on('checking-for-update',()=>emit('update:status',{state:'checking'}));
    autoUpdater.on('update-available',info=>{if(updateReady&&readyVersion===info.version)return;availableUpdate=true;updateReady=false;readyVersion=null;emit('update:status',{state:'available',version:info.version,notes:releaseNotesText(info.releaseNotes)});});
    autoUpdater.on('update-not-available',()=>{if(!updateReady){availableUpdate=false;emit('update:status',{state:'current'});}});
    autoUpdater.on('download-progress',p=>emit('update:status',{state:'downloading',percent:Math.round(p.percent)}));
    autoUpdater.on('update-downloaded',info=>{updateReady=true;readyVersion=info.version;const notes=releaseNotesText(info.releaseNotes);emit('update:status',{state:'ready',version:info.version,...(notes?{notes}:{})});});
    autoUpdater.on('error',error=>emit('update:status',{state:'error',message:error.message}));
    setTimeout(()=>autoUpdater.checkForUpdates().catch(()=>{}),7000);
    setInterval(()=>autoUpdater.checkForUpdates().catch(()=>{}),30*60*1000);
  }
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
