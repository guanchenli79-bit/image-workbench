const {app,BrowserWindow,ipcMain,dialog,clipboard} = require('electron');
const path = require('node:path');
const {currentMachineCode} = require('./license.cjs');
const {listLicenses,issueLicense,unbindLicense,renameLicense} = require('./admin-license.cjs');
const {AdminVault} = require('./admin-vault.cjs');

let window;
app.setName('画境卡密管理');
app.whenReady().then(()=>{
  const vault=new AdminVault(path.join(app.getPath('userData'),'admin-vault.json'));
  const authorized=(event)=>{
    if(!window || event.sender!==window.webContents)throw new Error('无效的管理窗口');
    vault.requireUnlocked();
  };
  ipcMain.handle('admin:status',event=>{if(event.sender!==window?.webContents)throw new Error('无效的管理窗口');return vault.status();});
  ipcMain.handle('admin:setup',(event,input)=>{if(event.sender!==window?.webContents)throw new Error('无效的管理窗口');return vault.setup(input?.password,input?.confirmation);});
  ipcMain.handle('admin:unlock',(event,password)=>{if(event.sender!==window?.webContents)throw new Error('无效的管理窗口');return vault.unlock(password);});
  ipcMain.handle('admin:lock',event=>{authorized(event);vault.lock();return vault.status();});
  ipcMain.handle('admin:list',event=>{authorized(event);return listLicenses(vault);});
  ipcMain.handle('admin:history',event=>{authorized(event);return vault.snapshot().history;});
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
  ipcMain.handle('admin:copy',(event,value)=>{authorized(event);clipboard.writeText(String(value||''));return true;});
  window=new BrowserWindow({width:1100,height:820,minWidth:850,minHeight:650,backgroundColor:'#eef2f8',title:'画境 · 卡密管理',icon:path.join(__dirname,'..','assets','logo.ico'),autoHideMenuBar:true,
    webPreferences:{preload:path.join(__dirname,'admin-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.on('will-navigate',event=>event.preventDefault());
  window.loadFile(path.join(__dirname,'admin-ui','index.html'));
  window.on('closed',()=>vault.lock());
});
app.on('window-all-closed',()=>app.quit());
