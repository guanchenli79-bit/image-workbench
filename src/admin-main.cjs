const {app,BrowserWindow,ipcMain,dialog,clipboard,desktopCapturer,session,safeStorage} = require('electron');
const path = require('node:path');
const fsp = require('node:fs/promises');
const {adminList,adminAction}=require('./approval.cjs');
const {readManifest,addWallpaper,addRecordedWallpaper,selectWallpaper,removeWallpaper}=require('./admin-wallpapers.cjs');
const {AdminVault} = require('./admin-vault.cjs');

let window;
// Keep the original app name so existing encrypted administrator records survive upgrades.
app.setName('??????');
app.whenReady().then(()=>{
  const vault=new AdminVault(path.join(app.getPath('userData'),'admin-vault.json'));
  const tokenFile=path.join(app.getPath('userData'),'approval-admin-token.json');
  const bootstrapFile=path.join(app.getPath('userData'),'approval-admin-token.txt');
  let tokenPromise;
  async function loadAdminToken(){
    if(!safeStorage.isEncryptionAvailable())throw new Error('?????????');
    try{return safeStorage.decryptString(Buffer.from(JSON.parse(await fsp.readFile(tokenFile,'utf8')).data,'base64'));}
    catch{
      let token;
      try{token=(await fsp.readFile(bootstrapFile,'utf8')).trim();}
      catch{throw new Error('???????????????????');}
      if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('????????????');
      await fsp.writeFile(tokenFile,JSON.stringify({data:safeStorage.encryptString(token).toString('base64')}),{flag:'wx'});
      await fsp.rm(bootstrapFile,{force:true});
      return token;
    }
  }
  function adminToken(){
    if(!tokenPromise)tokenPromise=loadAdminToken().catch(error=>{tokenPromise=null;throw error;});
    return tokenPromise;
  }
  adminToken().catch(()=>{});
  const authorized=(event)=>{
    if(!window || event.sender!==window.webContents)throw new Error('???????');
    vault.requireUnlocked();
  };
  session.defaultSession.setDisplayMediaRequestHandler(async(request,callback)=>{
    try{
      if(!window||request.frame!==window.webContents.mainFrame)throw new Error('???????');
      vault.requireUnlocked();
      const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:1,height:1}});
      if(!sources.length)throw new Error('?????????');
      callback({video:sources[0]});
    }catch{callback({});}
  });
  ipcMain.handle('admin:status',event=>{if(event.sender!==window?.webContents)throw new Error('???????');return vault.status();});
  ipcMain.handle('admin:setup',(event,input)=>{if(event.sender!==window?.webContents)throw new Error('???????');return vault.setup(input?.password,input?.confirmation);});
  ipcMain.handle('admin:unlock',(event,password)=>{if(event.sender!==window?.webContents)throw new Error('???????');return vault.unlock(password);});
  ipcMain.handle('admin:lock',event=>{authorized(event);vault.lock();return vault.status();});
  ipcMain.handle('admin:applications',async(event,input)=>{authorized(event);return adminList(await adminToken(),input?.offset||0,input?.limit||200);});
  ipcMain.handle('admin:application-action',async(event,input)=>{
    authorized(event);
    if(!/^[0-9a-f-]{36}$/.test(input?.id||''))throw new Error('??????');
    if(!['approve','reject','unbind','rebind','expiry','rename','delete'].includes(input?.action))throw new Error('????');
    if(['unbind','rebind','delete'].includes(input.action)){
      const {response}=await dialog.showMessageBox(window,{type:'warning',message:input.action==='delete'?'???????????':input.action==='rebind'?'??????????':'?????????',buttons:['??','??'],defaultId:0,cancelId:0});
      if(response!==1)return null;
    }
    vault.requireUnlocked();
    return adminAction(await adminToken(),input.id,input.action,input.data||{});
  });
  ipcMain.handle('admin:legacy-history',event=>{authorized(event);return vault.snapshot().bindings;});
  ipcMain.handle('admin:wallpapers',async event=>{authorized(event);return (await readManifest()).manifest;});
  ipcMain.handle('admin:wallpaper-add',async event=>{
    authorized(event);
    const picked=await dialog.showOpenDialog(window,{title:'??????',properties:['openFile'],filters:[{name:'?????',extensions:['jpg','jpeg','png','webp','mp4','webm']}]});
    if(picked.canceled)return null;
    vault.requireUnlocked();
    return addWallpaper(picked.filePaths[0],path.parse(picked.filePaths[0]).name);
  });
  ipcMain.handle('admin:wallpaper-import-scene',async event=>{
    authorized(event);
    const picked=await dialog.showOpenDialog(window,{title:'?? Wallpaper Engine ????',properties:['openDirectory']});
    if(picked.canceled)return null;
    vault.requireUnlocked();
    const folder=picked.filePaths[0];
    const project=JSON.parse(await fsp.readFile(path.join(folder,'project.json'),'utf8'));
    const title=String(project.title||path.basename(folder)).slice(0,60);
    if(String(project.type).toLowerCase()==='video'){
      const file=path.join(folder,path.basename(project.file||''));
      if(!/\.(mp4|webm)$/i.test(file))throw new Error('???????????????? MP4 ? WEBM');
      return {manifest:await addWallpaper(file,title)};
    }
    if(String(project.type).toLowerCase()!=='scene'||!project.file||path.extname(project.file).toLowerCase()!=='.json')throw new Error('????? Wallpaper Engine ???????');
    await fsp.access(path.join(folder,'scene.pkg'));
    return {recording:{title}};
  });
  ipcMain.handle('admin:wallpaper-record-hide',event=>{
    authorized(event);
    setTimeout(()=>window?.hide(),50);
    return true;
  });
  ipcMain.handle('admin:wallpaper-record-show',event=>{authorized(event);window.show();window.focus();return true;});
  ipcMain.handle('admin:wallpaper-record-publish',(event,input)=>{
    authorized(event);
    return addRecordedWallpaper(input?.bytes,input?.name);
  });
  ipcMain.handle('admin:wallpaper-select',(event,id)=>{authorized(event);return selectWallpaper(id);});
  ipcMain.handle('admin:wallpaper-delete',async(event,id)=>{
    authorized(event);
    const {response}=await dialog.showMessageBox(window,{type:'warning',title:'???????',message:'??????????????????????????',buttons:['??','????'],defaultId:0,cancelId:0,noLink:true});
    if(response!==1)return null;
    vault.requireUnlocked();
    return removeWallpaper(id);
  });
  ipcMain.handle('admin:copy',(event,value)=>{authorized(event);clipboard.writeText(String(value||''));return true;});
  window=new BrowserWindow({width:1100,height:820,minWidth:850,minHeight:650,backgroundColor:'#eef2f8',title:'?? ? ??????',icon:path.join(__dirname,'..','assets','logo.ico'),autoHideMenuBar:true,
    webPreferences:{preload:path.join(__dirname,'admin-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.loadFile(path.join(__dirname,'admin-ui','index.html'));
  window.on('closed',()=>vault.lock());
});
app.on('window-all-closed',()=>app.quit());
