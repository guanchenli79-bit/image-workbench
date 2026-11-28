const { app, BrowserWindow, ipcMain, dialog, safeStorage, protocol, net, shell, Menu, clipboard, ClipboardItem, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { imageModels, videoModels, presets } = require('./catalog.cjs');
const {providerFor,grsaiSpec,syncImageModels} = require('./providers.cjs');
const {CHANNELS,channelFor,imageApiBases,requestBase} = require('./channels.cjs');
const { resolveSize } = require('./sizing.cjs');
const { modelGoSeedreamSpec } = require('./seedream.cjs');
const {emptyManifest,validateManifest,modelsPathFor,mergeRules}=require('./model-rules.cjs');
const { normalizeBase, generateImage, generateVideo, queryTask } = require('./api.cjs');
const { networkFetch } = require('./network.cjs');
const { recoverSubmittedMidjourney } = require('./recovery.cjs');
const { releaseNotesText, updateErrorMessage } = require('./update-notes.cjs');
const { prepareReference, prepareGeneratedReference, generatedReferenceFile, MAX_REFERENCES } = require('./references.cjs');
const { currentMachineCode, normalizeLicenseKey, hashCode, findLicense, fetchRegistry } = require('./license.cjs');
const {fetchManifest,downloadWallpaper,sha256}=require('./wallpapers.cjs');
const {loadIdentity,submitApplication,getApplication,getAnnouncement,openAnnouncementSocket,getModelRules}=require('./approval.cjs');
const {migrateMultimodalHistory}=require('./maintenance-migration.cjs');

// Both the original workbench and Xiongba use this directory. Keep it stable
// even when the visible product name changes during the maintenance release.
const sharedDataPath=path.join(app.getPath('appData'),'image-workbench');
require('node:fs').mkdirSync(sharedDataPath,{recursive:true});
app.setPath('userData',sharedDataPath);

protocol.registerSchemesAsPrivileged([
  {scheme:'workbench-media',privileges:{secure:true,standard:true,supportFetchAPI:true,stream:true}},
  {scheme:'workbench-wallpaper',privileges:{secure:true,standard:true,supportFetchAPI:true,stream:true}}
]);

let mainWindow;
let records = [];
let settings = {baseUrl:'https://www.geeknow.top',apiKey:''};
let profiles = {};
let selectedModels = {};
let activeChannelId = 'custom';
let advancedBaseUrl = '';
let settingsPersistQueue = Promise.resolve();
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
let licenseMachineCode = null;
let licenseMachineError = '';
let licenseRecord = null;
let licenseRefreshInFlight = false;
let licenseReason = '';
let deviceIdentity = null;
let approvalStatus = {status:'none'};
let approvalReason = '';
let approvalCheckedAt = 0;
let approvalRequest = null;
let applicationSubmitting = false;
let approvalTimer;
let workspaceUnlocked = false;
let announcement = null;
let readAnnouncements = new Set();
let announcementSocket = null;
let announcementSocketRetryAt = 0;
let announcementRefresh = null;
let announcementRefreshPending = false;
let modelRules=emptyManifest();
let rulesRefresh=null;
let rulesRefreshPending=false;
let retryRulesAfter=0;
let currentWallpaper={id:'original',kind:'bundled'};
let wallpaperSyncing=false;

function files() {
  const dir = app.getPath('userData');
  return {dir, settings:path.join(dir,'settings.json'),history:path.join(dir,'history.json'),license:path.join(dir,'license.json'),media:path.join(dir,'temporary-media'),
    announcementReads:path.join(dir,'announcement-reads.json'),modelRules:path.join(dir,'model-rules.json'),wallpaper:path.join(dir,'wallpaper-state.json'),wallpaperCache:path.join(dir,'wallpaper-cache')};
}
function wallpaperDescriptor(){
  return currentWallpaper.kind==='bundled'?{id:'original',kind:'video',url:'../../assets/activation-wallpaper.mp4'}:
    {id:currentWallpaper.id,kind:currentWallpaper.kind,url:`workbench-wallpaper://current/${path.basename(currentWallpaper.file)}`};
}
async function loadCachedWallpaper(){
  try{
    const saved=JSON.parse(await fsp.readFile(files().wallpaper,'utf8'));
    if(saved.kind==='bundled')return;
    const file=path.join(files().wallpaperCache,path.basename(saved.file||''));
    const data=await fsp.readFile(file);
    if(sha256(data)===saved.sha256)currentWallpaper={id:saved.id,kind:saved.kind,file,sha256:saved.sha256};
  }catch{}
}
async function syncWallpaper(){
  if(wallpaperSyncing)return;
  wallpaperSyncing=true;
  try{
    const manifest=await fetchManifest();
    const selected=manifest.items.find(item=>item.id===manifest.activeId);
    const next=selected.kind==='bundled'?{id:'original',kind:'bundled'}:
      {id:selected.id,kind:selected.kind,file:await downloadWallpaper(selected,files().wallpaperCache),sha256:selected.sha256};
    if(next.id!==currentWallpaper.id||next.sha256!==currentWallpaper.sha256){
      currentWallpaper=next;
      await writeJson(files().wallpaper,{...next,file:next.file?path.basename(next.file):undefined});
      emit('wallpaper:changed',wallpaperDescriptor());
    }
  }catch{}finally{wallpaperSyncing=false;}
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
function fallbackGrsaiModels() {
  return [
    {name:'gpt-image-2',desc:'支持1K'},
    {name:'gpt-image-2-vip',desc:'支持1K、2K、4K'},
    {name:'gpt-image-2.5',desc:'支持1K'},
    {name:'nano-banana-2-cl',desc:'支持1K'}
  ].map(item=>grsaiSpec({type:'image',closeModel:false,...item}));
}
function activeProfile() { return profiles[settings.baseUrl]; }
function activeImageModels() {
  const profile=activeProfile();
  let models=[];
  if(profile?.syncedAt||profile?.models?.length){
    const apiBase=profile.imageApiBase||imageApiBases(settings.baseUrl)[0];
    models=profile.models.map(model=>modelGoSeedreamSpec(model.id,apiBase)||model);
  }else if(providerFor(settings.baseUrl)==='grsai'&&profile?.apiKey)models=fallbackGrsaiModels();
  else if(providerFor(settings.baseUrl)==='geeknow')models=imageModels;
  return mergeRules(models,profile?.catalogModelIds||profile?.unsupportedModels||[],modelRules.config,settings.baseUrl,Boolean(profile?.apiKey));
}
function activeVideoModels() {
  if(providerFor(settings.baseUrl)==='geeknow')return videoModels;
  return [{id:'video-needs-adaptation',label:'此端口视频模型待适配',family:'视频',adapter:'unsupported',refs:false,ratios:['16:9'],seconds:[4],resolutions:['default']}];
}
function profileSettings(baseUrl) {
  const profile=profiles[baseUrl];
  return {baseUrl,apiKey:profile?.apiKey||'',imageApiBase:profile?.imageApiBase};
}
function modelSnapshot(extra={}) {
  return {settings:publicSettings(),imageModels:activeImageModels(),videoModels:activeVideoModels(),...extra};
}
async function syncActiveModels() {
  const baseUrl=settings.baseUrl;
  const profile=profiles[baseUrl];
  if(!profile?.apiKey)throw new Error('请先录入当前渠道的 API Key');
  const modelsPath=modelsPathFor(modelRules.config,baseUrl);
  const result=await syncImageModels({...profileSettings(baseUrl),modelsPath});
  if(profiles[baseUrl]!==profile||modelsPathFor(modelRules.config,baseUrl)!==modelsPath)return modelSnapshot();
  profile.catalogModelIds=result.catalogModelIds||[];
  profile.models=result.models;
  profile.supported=result.models.length>0;
  profile.syncedAt=Date.now();
  profile.source=result.source;
  profile.imageApiBase=result.imageApiBase;
  if(settings.baseUrl===baseUrl)settings=profileSettings(baseUrl);
  profile.unsupportedCount=result.unsupportedCount;
  profile.unsupportedModels=result.unsupportedModels||[];
  await persistSettings();
  if(settings.baseUrl===baseUrl && workspaceUnlocked)emit('models:changed',modelSnapshot());
  return modelSnapshot();
}
async function loadState() {
  const p = files();
  await fsp.mkdir(p.media,{recursive:true});
  await loadCachedWallpaper();
  try{modelRules=validateManifest(JSON.parse(await fsp.readFile(p.modelRules,'utf8')));}catch{}
  try { licenseMachineCode=await currentMachineCode(); } catch(error) { licenseMachineError=error.message; }
  try { deviceIdentity=await loadIdentity(app,safeStorage); } catch(error) { approvalReason=error.message; }
  try {
    const stored=JSON.parse(await fsp.readFile(p.license,'utf8'));
    const decoded=decrypted(stored.data);
    const record=JSON.parse(decoded);
    if(record.machineHash===hashCode('machine',licenseMachineCode) && /^[0-9a-f]{64}$/.test(record.keyHash))licenseRecord=record;
  } catch {}
  try {
    const stored=JSON.parse(await fsp.readFile(p.settings,'utf8'));
    const activeBase=normalizeBase(stored.baseUrl||stored.activeBaseUrl);
    if(stored.profiles&&typeof stored.profiles==='object'){
      for(const [rawBase,entry] of Object.entries(stored.profiles)){
        try{
          const base=normalizeBase(rawBase);
          const multimodalProfile=Boolean(entry.key||entry.syncInfo);
          profiles[base]={apiKey:decrypted(entry.key||entry.apiKey),models:multimodalProfile?[]:Array.isArray(entry.models)?entry.models.slice(0,500):[],
            supported:multimodalProfile?true:Boolean(entry.supported),syncedAt:multimodalProfile?0:Number(entry.syncedAt)||0,source:multimodalProfile?'待重新同步':String(entry.source||''),unsupportedCount:Number(entry.unsupportedCount)||0,
            unsupportedModels:!multimodalProfile&&Array.isArray(entry.unsupportedModels)?entry.unsupportedModels.slice(0,500):[],
            imageApiBase:!multimodalProfile&&typeof entry.imageApiBase==='string'?entry.imageApiBase:undefined,
            catalogModelIds:!multimodalProfile&&Array.isArray(entry.catalogModelIds)?entry.catalogModelIds.slice(0,3000):undefined};
        }catch{}
      }
    } else profiles[activeBase]={apiKey:decrypted(stored.apiKey),models:[],supported:providerFor(activeBase)!=='openai-compatible'};
    if(!profiles[activeBase])profiles[activeBase]={apiKey:'',models:[],supported:providerFor(activeBase)!=='openai-compatible'};
    selectedModels=stored.selectedModels&&typeof stored.selectedModels==='object'?stored.selectedModels:{};
    activeChannelId=stored.activeChannelId==='custom'?'custom':channelFor(activeBase)?.id||'custom';
    if(stored.advancedBaseUrl){
      try{advancedBaseUrl=normalizeBase(stored.advancedBaseUrl);}catch{}
    }else if(activeChannelId==='custom')advancedBaseUrl=activeBase;
    settings=profileSettings(activeBase);
  } catch {}
  try {
    const ids=JSON.parse(await fsp.readFile(p.announcementReads,'utf8'));
    if(Array.isArray(ids))readAnnouncements=new Set(ids.filter(id=>typeof id==='string'&&/^[0-9a-f-]{36}$/.test(id)));
  } catch {}
  try {
    const stored=JSON.parse(await fsp.readFile(p.history,'utf8'));
    if(Array.isArray(stored))records=stored;
    else if(Array.isArray(stored?.history)){
      // Preserve conversations and text replies before converting media tasks.
      await fsp.copyFile(p.history,path.join(p.dir,'history-before-maintenance.json'),require('node:fs').constants.COPYFILE_EXCL).catch(()=>{});
      records=migrateMultimodalHistory(stored.history);
      await persistRecords();
    } else records=[];
  } catch { records=[]; }
  if(recoverSubmittedMidjourney(records))await persistRecords();
  await pruneExpired();
}

function publishLicenseStatus(){
  const status=licenseStatus();
  if(!status.active)workspaceUnlocked=false;
  emit('license:status',{...status,loggedIn:workspaceUnlocked});
  return status;
}
function refreshApproval(){
  if(approvalRequest)return approvalRequest;
  if(!deviceIdentity||!licenseMachineCode||applicationSubmitting)return;
  approvalRequest=(async()=>{
    try{
      approvalStatus=await getApplication(deviceIdentity,licenseMachineCode);
      approvalCheckedAt=Date.now();
      approvalReason='';
    }catch(error){approvalReason='审批服务暂不可用：'+error.message;}
    finally{approvalRequest=null;}
    publishLicenseStatus();
    maintainAnnouncementConnection();
  })();
  return approvalRequest;
}
function scheduleApprovalRefresh(){
  const delay=['none','pending'].includes(approvalStatus.status)?5000:30000;
  clearTimeout(approvalTimer);
  approvalTimer=setTimeout(async()=>{await refreshApproval();scheduleApprovalRefresh();},delay);
}
function unreadAnnouncement(){
  return announcement&&!readAnnouncements.has(announcement.id)?announcement:null;
}
function setAnnouncement(value){
  const oldId=unreadAnnouncement()?.id;
  announcement=value||null;
  const unread=unreadAnnouncement();
  if(oldId!==unread?.id)emit('announcement:changed',unread);
}
function refreshAnnouncement(){
  if(announcementRefresh){announcementRefreshPending=true;return announcementRefresh;}
  const status=licenseStatus();
  if(status.status!=='approved'||!status.active)return;
  announcementRefresh=(async()=>{
    do {
      announcementRefreshPending=false;
      try {
        const result=await getAnnouncement(deviceIdentity,licenseMachineCode);
        const status=licenseStatus();
        if(status.active&&status.status==='approved')setAnnouncement(result.announcement);
      }catch(error){
        if(error.status===403)setAnnouncement(null);
      }
    }while(announcementRefreshPending&&licenseStatus().active);
  })().finally(()=>{announcementRefresh=null;});
  return announcementRefresh;
}
function refreshModelRules(force=false){
  if(rulesRefresh){if(force)rulesRefreshPending=true;return rulesRefresh;}
  const approved=()=>{const status=licenseStatus();return status.active&&status.status==='approved';};
  if(!approved()||!force&&Date.now()<retryRulesAfter)return;
  rulesRefresh=(async()=>{
    do{
      rulesRefreshPending=false;
      try{
        const incoming=validateManifest((await getModelRules(deviceIdentity,licenseMachineCode)).manifest);
        if(!approved()||incoming.revision<=modelRules.revision)continue;
        const previousPath=modelsPathFor(modelRules.config,settings.baseUrl);
        await writeJson(files().modelRules,incoming);
        modelRules=incoming;
        if(workspaceUnlocked){
          emit('models:changed',modelSnapshot());
          if(settings.apiKey&&previousPath!==modelsPathFor(modelRules.config,settings.baseUrl))
            void syncActiveModels().catch(error=>emit('models:sync-error',error.message));
        }
      }catch(error){
        retryRulesAfter=Date.now()+(error.status===404?120000:15000);
      }
    }while(rulesRefreshPending&&approved());
  })().finally(()=>{rulesRefresh=null;});
  return rulesRefresh;
}
function maintainAnnouncementConnection(){
  const status=licenseStatus();
  if(!status.active||status.status!=='approved'){
    const socket=announcementSocket;
    announcementSocket=null;
    socket?.close();
    setAnnouncement(null);
    return;
  }
  if(announcementSocket?.readyState===1)return;
  void refreshAnnouncement();
  void refreshModelRules();
  if(announcementSocket||Date.now()<announcementSocketRetryAt)return;
  try{
    const socket=openAnnouncementSocket(deviceIdentity,licenseMachineCode);
    announcementSocket=socket;
    const timeout=setTimeout(()=>{if(socket.readyState===0)socket.close();},12000);
    socket.addEventListener('open',()=>{
      clearTimeout(timeout);
      void refreshModelRules(true);
    },{once:true});
    socket.addEventListener('message',event=>{
      if(event.data==='changed')void refreshAnnouncement();
      if(event.data==='model-rules-changed')void refreshModelRules(true);
    });
    const reconnect=()=>{
      clearTimeout(timeout);
      if(announcementSocket!==socket)return;
      announcementSocket=null;
      announcementSocketRetryAt=Date.now()+30000;
    };
    socket.addEventListener('close',reconnect,{once:true});
    socket.addEventListener('error',reconnect,{once:true});
  }catch{announcementSocketRetryAt=Date.now()+30000;}
}
async function markAnnouncementRead(id){
  if(typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id))throw new Error('公告编号无效');
  if(readAnnouncements.has(id)||announcement?.id!==id)return unreadAnnouncement();
  const next=new Set(readAnnouncements).add(id);
  await writeJson(files().announcementReads,[...next]);
  readAnnouncements=next;
  const unread=unreadAnnouncement();
  emit('announcement:changed',unread);
  return unread;
}
function licenseStatus() {
  const now=Date.now();
  if(approvalStatus.status!=='none'){
    const active=approvalStatus.status==='approved'&&Date.parse(approvalStatus.expiresAt)>now&&now-approvalCheckedAt<5*60*1000;
    const labels={approved:'审批状态尚未确认，请稍后重试',pending:'申请已提交，等待管理员审批',rejected:`申请已驳回${approvalStatus.reason?`：${approvalStatus.reason}`:''}，可重新提交`,unbound:'设备已解绑，可重新提交申请',expired:'绑定已到期，请重新提交申请'};
    return {active,machineCode:licenseMachineCode||'',expiresAt:active?approvalStatus.expiresAt:null,status:approvalStatus.status,name:approvalStatus.name||'',message:active?'已通过审批':approvalReason||labels[approvalStatus.status]||'请提交使用申请'};
  }
  const valid=!!licenseMachineCode && !!licenseRecord && Date.parse(licenseRecord.expiresAt)>now && now+5*60*1000>=Number(licenseRecord.lastSeenAt||0);
  return {active:valid,machineCode:licenseMachineCode||'',expiresAt:valid?licenseRecord.expiresAt:null,
    status:valid?'legacy':(!approvalCheckedAt&&!approvalReason&&!licenseMachineError?'checking':'none'),message:licenseMachineError || approvalReason || licenseReason ||
    (valid?'已绑定此设备':!approvalCheckedAt?'正在核验设备…':licenseRecord?'旧版授权已到期，请提交使用申请':'填写用户名和密码，向管理员提交使用申请')};
}
function requireLicense() {
  const status=licenseStatus();
  if(!status.active){publishLicenseStatus();throw new Error(status.message);}
  if(!workspaceUnlocked)throw new Error('请先点击登录');
}
async function persistLicense() {
  if(!licenseRecord){await fsp.rm(files().license,{force:true});return;}
  if(!safeStorage.isEncryptionAvailable())throw new Error('Windows 安全存储不可用，无法保存授权');
  await writeJson(files().license,{data:encrypted(JSON.stringify(licenseRecord))});
}
async function activateLicense(input) {
  if(!licenseMachineCode)throw new Error(licenseMachineError||'机器码不可用');
  const key=normalizeLicenseKey(input);
  const registry=await fetchRegistry(undefined,{preferApi:true});
  const match=findLicense(registry,licenseMachineCode,key);
  if(!match)throw new Error('卡密无效、已解绑、已到期，或与这台机器不匹配');
  licenseRecord={machineHash:hashCode('machine',licenseMachineCode),keyHash:hashCode('license',key),expiresAt:match.expiresAt,lastSeenAt:Date.now()};
  licenseReason='';
  await persistLicense();
  publishLicenseStatus();
  return licenseStatus();
}
async function refreshLicense() {
  if(licenseRefreshInFlight||!licenseRecord||!licenseMachineCode)return;
  licenseRefreshInFlight=true;
  try {
    const registry=await fetchRegistry();
    const match=registry.entries.find(entry=>entry.machineHash===licenseRecord.machineHash&&entry.keyHash===licenseRecord.keyHash&&Date.parse(entry.expiresAt)>Date.now());
    if(!match){licenseRecord=null;licenseReason='授权已被管理员解绑或已到期，请重新获取卡密';}
    else {licenseRecord.expiresAt=match.expiresAt;licenseRecord.lastSeenAt=Date.now();licenseReason='';}
    await persistLicense();
    publishLicenseStatus();
  } catch {} finally { licenseRefreshInFlight=false; }
}
function persistSettings() {
  settingsPersistQueue=settingsPersistQueue.catch(()=>{}).then(async()=>{
    const stored={baseUrl:settings.baseUrl,activeChannelId,advancedBaseUrl,profiles:{},selectedModels};
    for(const [base,profile] of Object.entries(profiles))
      stored.profiles[base]={apiKey:encrypted(profile.apiKey),models:profile.models||[],supported:Boolean(profile.supported),
        syncedAt:profile.syncedAt||0,source:profile.source||'',unsupportedCount:profile.unsupportedCount||0,unsupportedModels:profile.unsupportedModels||[],imageApiBase:profile.imageApiBase,catalogModelIds:profile.catalogModelIds};
    await writeJson(files().settings,stored);
  });
  return settingsPersistQueue;
}
function publicSettings() {
  const profile=activeProfile();
  const channel=CHANNELS.find(item=>item.id===activeChannelId);
  const available=activeImageModels();
  const managed=available.filter(model=>model.adapter==='managed-image');
  const unsupportedModels=(profile?.unsupportedModels||[]).filter(id=>!available.some(model=>model.id===id));
  return {baseUrl:settings.baseUrl,channelId:activeChannelId,channelLabel:channel?.label||'自定义接口',
    customBaseUrl:advancedBaseUrl||settings.baseUrl,
    hasKey:!!settings.apiKey,keyTail:settings.apiKey?settings.apiKey.slice(-4):'',
    syncedAt:profile?.syncedAt||0,supported:profile?.supported!==false||managed.length>0,
    unsupportedCount:profile?.unsupportedModels?.length?unsupportedModels.length:profile?.unsupportedCount||0,unsupportedModels,
    ruleRevision:modelRules.revision,managedModelCount:managed.length,
    channels:CHANNELS.map(({id,label})=>({id,label})),selectedModels:selectedModels[settings.baseUrl]||{}};
}
function endpointKeyInfo(baseUrl){
  const key=profiles[baseUrl]?.apiKey||'';
  return {hasKey:!!key,keyTail:key.slice(-4)};
}
function storeReferences(inputs,{expiresAt=null}={}) {
  if (!Array.isArray(inputs) || !inputs.length) return [];
  if (inputs.length + refs.size > MAX_REFERENCES) throw new Error(`参考图最多支持 ${MAX_REFERENCES} 张，请先移除多余图片`);
  const prepared = inputs.map(input=>prepareReference(input.name,input.bytes));
  return prepared.map(({buffer,mime,name})=>{
    const id=crypto.randomUUID();
    refs.set(id,{buffer,mime,name,addedAt:Date.now(),expiresAt});
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
  requireLicense();
  const {record,file}=availableMedia(id,index);
  const ext=path.extname(file);
  const chosen=await dialog.showSaveDialog(mainWindow,{title:'永久保存作品',defaultPath:`${record.modelId}-${new Date(record.createdAt).toISOString().slice(0,10)}${ext}`,filters:[{name:record.type==='video'?'视频':'图片',extensions:[ext.slice(1)]}]});
  if(chosen.canceled)return false;
  await fsp.copyFile(file,chosen.filePath);return true;
}
async function copyImage(id,index) {
  requireLicense();
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
  const expiredReferences=[];
  for(const [id,reference] of refs)if(reference.expiresAt && Date.now()>=reference.expiresAt){refs.delete(id);expiredReferences.push(id);}
  if(expiredReferences.length)emit('reference:expired',expiredReferences);
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
  if(polling || !workspaceUnlocked || !licenseStatus().active)return;
  polling=true;
  try {
    const pending=records.filter(r=>r.status==='pending' && r.taskId);
    await Promise.allSettled(pending.map(async record=>{
      try {
        const oldGeeknow=Object.keys(profiles).find(base=>providerFor(base)==='geeknow');
        const taskSettings=profileSettings(record.baseUrl||oldGeeknow||settings.baseUrl);
        if(!taskSettings.apiKey){record.lastPollError='原端口的 API Key 已清除，无法继续查询任务';return;}
        const result=await queryTask(taskSettings,record.taskAdapter,record.taskId,record.type);
        if(!records.includes(record))return;
        if(result.status==='complete') await completeRecord(record,result.items,taskSettings);
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
    if(!workspaceUnlocked||params.mediaType!=='image')return;
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
  const loginPage=()=>({license:{...licenseStatus(),loggedIn:workspaceUnlocked},wallpaper:wallpaperDescriptor(),
    announcement:unreadAnnouncement(),version:app.getVersion(),isPackaged:app.isPackaged});
  const workspace=()=>({...loginPage(),...modelSnapshot(),presets,history:listHistory()});
  ipcMain.handle('app:init',()=>workspaceUnlocked&&licenseStatus().active?workspace():loginPage());
  ipcMain.handle('approval:login',async()=>{
    await refreshApproval();
    const status=licenseStatus();
    if(!status.active||(status.status==='approved'&&approvalReason))throw new Error(approvalReason||status.message);
    workspaceUnlocked=true;
    void refreshModelRules();
    if(settings.apiKey)void syncActiveModels().catch(error=>emit('models:sync-error',error.message));
    void pollTasks();
    return workspace();
  });
  ipcMain.handle('announcement:read',(_,id)=>markAnnouncementRead(id));
  ipcMain.handle('approval:submit',async(_,input)=>{
    if(!deviceIdentity||!licenseMachineCode)throw new Error(approvalReason||licenseMachineError||'设备身份不可用');
    if(applicationSubmitting)throw new Error('申请正在提交，请稍候');
    applicationSubmitting=true;
    try {
      await approvalRequest;
      approvalStatus=await submitApplication(deviceIdentity,licenseMachineCode,String(input?.username||'').trim(),String(input?.password||''));
      approvalCheckedAt=Date.now();
      approvalReason='';
      scheduleApprovalRefresh();
      maintainAnnouncementConnection();
      return publishLicenseStatus();
    } finally { applicationSubmitting=false; }
  });
  ipcMain.handle('approval:refresh',async()=>{await refreshApproval();return licenseStatus();});
  ipcMain.handle('license:copy-machine',()=>{if(!licenseMachineCode)throw new Error(licenseMachineError||'机器码不可用');clipboard.writeText(licenseMachineCode);return true;});
  ipcMain.handle('settings:key-info',(_,input)=>{requireLicense();return endpointKeyInfo(requestBase(input));});
  ipcMain.handle('settings:model',async(_,input)=>{
    requireLicense();
    if(input.baseUrl!==settings.baseUrl)return;
    const type=input.type==='video'?'video':'image';
    const models=type==='video'?activeVideoModels():activeImageModels();
    if(!models.some(model=>model.id===input.modelId&&model.adapter!=='unsupported'))return;
    selectedModels[settings.baseUrl]={...selectedModels[settings.baseUrl],[type]:input.modelId};
    await persistSettings();
  });
  ipcMain.handle('settings:save',async(_,input)=>{
    requireLicense();
    const baseUrl=requestBase(input);
    const apiKey=String(input.apiKey||'').trim();
    if(apiKey && !safeStorage.isEncryptionAvailable())throw new Error('系统安全存储不可用，无法保存 API Key');
    const previous=profiles[baseUrl];
    const profile={...previous,apiKey:input.clearKey?'':apiKey||previous?.apiKey||'',models:previous?.models||[]};
    if(apiKey && apiKey!==previous?.apiKey && providerFor(baseUrl)!=='geeknow'){
      Object.assign(profile,{models:[],syncedAt:0,source:'',supported:false,unsupportedCount:0,unsupportedModels:[],imageApiBase:undefined,catalogModelIds:undefined});
    }
    if(input.clearKey)Object.assign(profile,{models:[],syncedAt:0,source:'',supported:false,unsupportedCount:0,unsupportedModels:[],imageApiBase:undefined,catalogModelIds:undefined});
    if(input.channelId&&!profile.apiKey&&!input.clearKey)throw new Error('请先输入这个渠道的 API Key');
    profiles[baseUrl]=profile;
    if(input.clearKey&&settings.baseUrl!==baseUrl){
      await persistSettings();
      return modelSnapshot();
    }
    activeChannelId=input.channelId||channelFor(baseUrl)?.id||'custom';
    if(activeChannelId==='custom')advancedBaseUrl=baseUrl;
    settings=profileSettings(baseUrl);
    await persistSettings();
    if(!profile.apiKey || settings.baseUrl!==baseUrl)return modelSnapshot();
    try{return await syncActiveModels();}
    catch(error){return modelSnapshot({syncError:error.message});}
  });
  ipcMain.handle('settings:verify',async(_,input)=>{
    requireLicense();
    const baseUrl=requestBase(input);
    const candidate={baseUrl,apiKey:String(input.apiKey||'').trim()||profiles[baseUrl]?.apiKey||''};
    if(!candidate.apiKey)throw new Error('请先输入 API Key');
    const result=await syncImageModels({...candidate,modelsPath:modelsPathFor(modelRules.config,baseUrl)});
    const models=mergeRules(result.models,result.catalogModelIds||[],modelRules.config,baseUrl,true);
    return {ok:true,modelCount:models.length,authVerified:result.authVerified??result.provider!=='grsai'};
  });
  ipcMain.handle('models:sync',async()=>{requireLicense();await refreshModelRules(true);return syncActiveModels();});
  ipcMain.handle('size:resolve',async(_,input)=>{requireLicense();const model=[...activeImageModels(),...activeVideoModels()].find(x=>x.id===input.modelId);return model?resolveSize(model,input.presetId,input.prompt,input.referenceDimensions,input.resolutionId):null;});
  ipcMain.handle('reference:choose',async()=>{
    requireLicense();
    const picked=await dialog.showOpenDialog(mainWindow,{title:'选择参考图',properties:['openFile','multiSelections'],filters:[{name:'图片',extensions:['png','jpg','jpeg','webp']}]});
    if(picked.canceled)return [];
    if(picked.filePaths.length+refs.size>MAX_REFERENCES)throw new Error(`参考图最多支持 ${MAX_REFERENCES} 张，请先移除多余图片`);
    const inputs=await Promise.all(picked.filePaths.map(async file=>({name:path.basename(file),bytes:await fsp.readFile(file)})));
    return storeReferences(inputs);
  });
  ipcMain.handle('reference:add',async(_,inputs)=>{requireLicense();return storeReferences(inputs);});
  ipcMain.handle('reference:add-generated',async(_,id,index)=>{
    requireLicense();
    if(refs.size>=MAX_REFERENCES)throw new Error(`参考图最多支持 ${MAX_REFERENCES} 张，请先移除多余图片`);
    const name=generatedReferenceFile(records,id,index);
    const bytes=await fsp.readFile(path.join(files().media,name));
    const prepared=prepareGeneratedReference(name,bytes,nativeImage);
    // Recheck after disk IO: expiry or history clearing may have happened while reading.
    generatedReferenceFile(records,id,index);
    const expiresAt=records.find(record=>record.id===id).expiresAt;
    return storeReferences([{name:prepared.name,bytes:prepared.buffer}],{expiresAt});
  });
  ipcMain.handle('reference:clear',async(_,ids)=>{requireLicense();for(const id of ids||[])refs.delete(id);});
  ipcMain.handle('generate',async(_,input)=>{
    requireLicense();
    await pruneExpired();
    const type=input.type==='video'?'video':'image';
    const model=(type==='video'?activeVideoModels():activeImageModels()).find(x=>x.id===input.modelId);
    if(type==='image'&&input.ruleRevision!==undefined&&input.ruleRevision!==modelRules.revision)
      throw new Error('图片接口规则刚更新，请确认新的画幅和分辨率后重新提交');
    if(!model||model.adapter==='unsupported'||(model.adapter!=='managed-image'&&activeProfile()?.supported===false))
      throw new Error('当前渠道没有已适配的此类模型');
    if(!settings.apiKey)throw new Error('请先设置当前渠道的 API Key');
    const prompt=String(input.prompt||'').trim();if(!prompt)throw new Error('请填写提示词');
    if(prompt.length>8000)throw new Error('提示词过长');
    const references=(input.referenceIds||[]).map(id=>refs.get(id)).filter(Boolean);
    if(references.length!==(input.referenceIds||[]).length)throw new Error('部分参考图已过期或被移除，请重新添加');
    if(references.length>(model.maxRefs||10))throw new Error('当前模型最多支持 '+(model.maxRefs||10)+' 张参考图');
    if(references.length && !model.refs)throw new Error('该模型不支持参考图');
    if(model.requiredRefs && !references.length)throw new Error('该模型需要至少一张参考图');
    const sizing=resolveSize(model,input.presetId,prompt,input.referenceDimensions,type==='image'?input.resolutionId:undefined);
    const snapshot={...settings};
    const record={id:crypto.randomUUID(),type,modelId:model.id,modelName:model.label,baseUrl:settings.baseUrl,prompt,presetId:input.presetId,resolution:sizing.resolution,actualRatio:sizing.ratio,actualSize:sizing.size,status:'submitting',progress:0,createdAt:Date.now(),files:[]};
    records.unshift(record);await persistRecords();
    try {
      const result=type==='image'?await generateImage(snapshot,{prompt},model,sizing,references):await generateVideo(snapshot,{prompt,seconds:input.seconds},model,sizing,references);
      if(!records.includes(record))return {id:record.id,status:'cleared'};
      if(result.kind==='complete')await completeRecord(record,result.items,snapshot);
      else {record.status='pending';record.taskId=result.taskId;record.taskAdapter=result.taskAdapter;await persistRecords();setTimeout(pollTasks,1500);}
      return {id:record.id,status:record.status};
    } catch(error) {if(!records.includes(record))return {id:record.id,status:'cleared'};record.status='failed';record.error=error.message;await persistRecords();throw error;}
  });
  ipcMain.handle('history:list',async()=>{requireLicense();await pruneExpired();return listHistory();});
  ipcMain.handle('history:clear',async()=>{
    requireLicense();
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
  ipcMain.handle('history:save',async(_,id,index)=>{requireLicense();return saveResult(id,index);});
  ipcMain.handle('history:copy-prompt',(_,id)=>{
    requireLicense();
    const record=records.find(item=>item.id===id);
    if(!record?.prompt)throw new Error('这条任务没有可复制的提示词');
    clipboard.writeText(record.prompt);
    return true;
  });
  ipcMain.handle('updates:check',async()=>{if(!app.isPackaged)return {message:'开发模式不检查更新'};try{await autoUpdater.checkForUpdates();return {message:'正在检查更新'};}catch(error){throw new Error(updateErrorMessage(error));}});
  ipcMain.handle('updates:download',async()=>{if(!app.isPackaged||!availableUpdate)throw new Error('当前没有可下载的新版本');try{await autoUpdater.downloadUpdate();return {message:'更新已下载'};}catch(error){throw new Error(updateErrorMessage(error));}});
  ipcMain.handle('updates:install',()=>{if(!app.isPackaged||!updateReady)throw new Error('更新尚未下载完成');autoUpdater.quitAndInstall(false,true);});
}

app.whenReady().then(async()=>{
  await loadState();
  protocol.handle('workbench-media',async request=>{
    if(!workspaceUnlocked||!licenseStatus().active)return new Response('Not licensed',{status:403});
    const url=new URL(request.url);
    const [id,indexRaw]=url.pathname.split('/').filter(Boolean);
    if(url.hostname!=='item'||!/^[0-9a-f-]{36}$/.test(id||'')||!/^[0-9]+$/.test(indexRaw||''))return new Response('Not found',{status:404});
    const record=records.find(x=>x.id===id && x.status==='complete' && Date.now()<x.expiresAt);
    const name=record?.files?.[Number(indexRaw)];
    if(!name)return new Response('Expired',{status:404});
    return net.fetch(pathToFileURL(path.join(files().media,name)).toString());
  });
  protocol.handle('workbench-wallpaper',async request=>{
    const url=new URL(request.url);
    if(url.hostname!=='current'||currentWallpaper.kind==='bundled'||url.pathname!==`/${path.basename(currentWallpaper.file)}`)return new Response('Not found',{status:404});
    const range=request.headers.get('range');
    const headers=range&&/^bytes=\d*-\d*$/.test(range)?{Range:range}:{};
    return net.fetch(pathToFileURL(currentWallpaper.file).toString(),{headers});
  });
  registerIpc();createWindow();
  setTimeout(syncWallpaper,1200);setInterval(syncWallpaper,75*1000);
  void (async()=>{await refreshApproval();scheduleApprovalRefresh();})();
  setInterval(maintainAnnouncementConnection,15000);
  setInterval(refreshAnnouncement,180000);
  setInterval(refreshModelRules,180000);
  setInterval(pruneExpired,60*1000);setInterval(pollTasks,15*1000);setTimeout(pollTasks,2000);
  setTimeout(refreshLicense,3000);setInterval(refreshLicense,30*60*1000);

  if(app.isPackaged){
    autoUpdater.autoDownload=false;autoUpdater.autoInstallOnAppQuit=false;
    autoUpdater.fullChangelog=true;
    autoUpdater.on('checking-for-update',()=>emit('update:status',{state:'checking'}));
    autoUpdater.on('update-available',info=>{if(updateReady&&readyVersion===info.version)return;availableUpdate=true;updateReady=false;readyVersion=null;emit('update:status',{state:'available',version:info.version,notes:releaseNotesText(info.releaseNotes)});});
    autoUpdater.on('update-not-available',()=>{if(!updateReady){availableUpdate=false;emit('update:status',{state:'current'});}});
    autoUpdater.on('download-progress',p=>emit('update:status',{state:'downloading',percent:Math.round(p.percent)}));
    autoUpdater.on('update-downloaded',info=>{updateReady=true;readyVersion=info.version;const notes=releaseNotesText(info.releaseNotes);emit('update:status',{state:'ready',version:info.version,...(notes?{notes}:{})});});
    autoUpdater.on('error',error=>emit('update:status',{state:'error',message:updateErrorMessage(error)}));
    setTimeout(()=>autoUpdater.checkForUpdates().catch(()=>{}),7000);
    setInterval(()=>autoUpdater.checkForUpdates().catch(()=>{}),30*60*1000);
  }
});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
