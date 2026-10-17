const {app,BrowserWindow,ipcMain,dialog,clipboard,desktopCapturer,session} = require('electron');
const path = require('node:path');
const fsp = require('node:fs/promises');
const {currentMachineCode} = require('./license.cjs');
const {listLicenses,issueLicense,unbindLicense,renameLicense,rebindLicense,deleteBinding} = require('./admin-license.cjs');
const {readManifest,addWallpaper,addRecordedWallpaper,selectWallpaper,removeWallpaper}=require('./admin-wallpapers.cjs');
const {AdminVault} = require('./admin-vault.cjs');

let window;
app.setName('画境卡密管理');
app.whenReady().then(()=>{
  const vault=new AdminVault(path.join(app.getPath('userData'),'admin-vault.json'));
  const authorized=(event)=>{
    if(!window || event.sender!==window.webContents)throw new Error('无效的管理窗口');
    vault.requireUnlocked();
  };
  session.defaultSession.setDisplayMediaRequestHandler(async(request,callback)=>{
    try{
      if(!window||request.frame!==window.webContents.mainFrame)throw new Error('无效的录制窗口');
      vault.requireUnlocked();
      const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:1,height:1}});
      if(!sources.length)throw new Error('没有可录制的显示器');
      callback({video:sources[0]});
    }catch{callback({});}
  });
  ipcMain.handle('admin:status',event=>{if(event.sender!==window?.webContents)throw new Error('无效的管理窗口');return vault.status();});
  ipcMain.handle('admin:setup',(event,input)=>{if(event.sender!==window?.webContents)throw new Error('无效的管理窗口');return vault.setup(input?.password,input?.confirmation);});
  ipcMain.handle('admin:unlock',(event,password)=>{if(event.sender!==window?.webContents)throw new Error('无效的管理窗口');return vault.unlock(password);});
  ipcMain.handle('admin:lock',event=>{authorized(event);vault.lock();return vault.status();});
  ipcMain.handle('admin:list',event=>{authorized(event);return listLicenses(vault);});
  ipcMain.handle('admin:history',event=>{authorized(event);return vault.snapshot().history;});
  ipcMain.handle('admin:bindings-local',event=>{authorized(event);return vault.snapshot().bindings;});
  ipcMain.handle('admin:own-machine',event=>{authorized(event);return currentMachineCode();});
  ipcMain.handle('admin:issue',(event,input)=>{authorized(event);return issueLicense(input?.machineCode,input?.date,input?.name,vault);});
  ipcMain.handle('admin:rename',(event,input)=>{authorized(event);return renameLicense(input?.machineHash,input?.name,vault);});
  ipcMain.handle('admin:unbind',async(event,machineHash)=>{
    authorized(event);
    const {response}=await dialog.showMessageBox(window,{type:'warning',title:'解绑这台机器？',message:'解绑后，这台机器的当前卡密会在下次联网复核时失效。',detail:'离线期间可能继续使用到本地授权到期。解绑后可以重新签发。',buttons:['取消','确认解绑'],defaultId:0,cancelId:0,noLink:true});
    if(response!==1)return null;
    vault.requireUnlocked();
    return unbindLicense(machineHash,vault);
  });
  ipcMain.handle('admin:rebind',async(event,input)=>{
    authorized(event);
    const {response}=await dialog.showMessageBox(window,{type:'warning',title:'更换绑定机器？',message:'这张卡密将改绑到新的机器码。',detail:'原机器在下次联网复核时失效；离线期间可能继续使用到本地授权到期。',buttons:['取消','确认换绑'],defaultId:0,cancelId:0,noLink:true});
    if(response!==1)return null;
    vault.requireUnlocked();
    return rebindLicense(input?.key,input?.machineCode,vault);
  });
  ipcMain.handle('admin:binding-delete',async(event,key)=>{
    authorized(event);
    const {response}=await dialog.showMessageBox(window,{type:'warning',title:'永久删除绑定记录？',message:'将删除本机保存的机器码与卡密记录。',detail:'如果卡密仍有效，也会从在线授权库解绑。删除后明文卡密无法恢复。',buttons:['取消','永久删除'],defaultId:0,cancelId:0,noLink:true});
    if(response!==1)return null;
    vault.requireUnlocked();
    return deleteBinding(key,vault);
  });
  ipcMain.handle('admin:wallpapers',async event=>{authorized(event);return (await readManifest()).manifest;});
  ipcMain.handle('admin:wallpaper-add',async event=>{
    authorized(event);
    const picked=await dialog.showOpenDialog(window,{title:'添加首页壁纸',properties:['openFile'],filters:[{name:'图片或视频',extensions:['jpg','jpeg','png','webp','mp4','webm']}]});
    if(picked.canceled)return null;
    vault.requireUnlocked();
    return addWallpaper(picked.filePaths[0],path.parse(picked.filePaths[0]).name);
  });
  ipcMain.handle('admin:wallpaper-import-scene',async event=>{
    authorized(event);
    const picked=await dialog.showOpenDialog(window,{title:'导入 Wallpaper Engine 场景目录',properties:['openDirectory']});
    if(picked.canceled)return null;
    vault.requireUnlocked();
    const folder=picked.filePaths[0];
    const project=JSON.parse(await fsp.readFile(path.join(folder,'project.json'),'utf8'));
    const title=String(project.title||path.basename(folder)).slice(0,60);
    if(String(project.type).toLowerCase()==='video'){
      const file=path.join(folder,path.basename(project.file||''));
      if(!/\.(mp4|webm)$/i.test(file))throw new Error('此视频壁纸格式暂不支持，请转换为 MP4 或 WEBM');
      return {manifest:await addWallpaper(file,title)};
    }
    if(String(project.type).toLowerCase()!=='scene'||!project.file||path.extname(project.file).toLowerCase()!=='.json')throw new Error('没有识别到 Wallpaper Engine 场景或视频项目');
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
    const {response}=await dialog.showMessageBox(window,{type:'warning',title:'删除这张壁纸？',message:'壁纸会从在线壁纸库删除，用户端会自动切换到默认壁纸。',buttons:['取消','确认删除'],defaultId:0,cancelId:0,noLink:true});
    if(response!==1)return null;
    vault.requireUnlocked();
    return removeWallpaper(id);
  });
  ipcMain.handle('admin:copy',(event,value)=>{authorized(event);clipboard.writeText(String(value||''));return true;});
  window=new BrowserWindow({width:1100,height:820,minWidth:850,minHeight:650,backgroundColor:'#eef2f8',title:'画境 · 卡密管理',icon:path.join(__dirname,'..','assets','logo.ico'),autoHideMenuBar:true,
    webPreferences:{preload:path.join(__dirname,'admin-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.loadFile(path.join(__dirname,'admin-ui','index.html'));
  window.on('closed',()=>vault.lock());
});
app.on('window-all-closed',()=>app.quit());
