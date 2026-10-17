const {app,BrowserWindow,ipcMain,dialog,clipboard} = require('electron');
const path = require('node:path');
const {currentMachineCode} = require('./license.cjs');
const {listLicenses,issueLicense,unbindLicense} = require('./admin-license.cjs');

let window;
app.whenReady().then(()=>{
  ipcMain.handle('admin:list',()=>listLicenses());
  ipcMain.handle('admin:own-machine',()=>currentMachineCode());
  ipcMain.handle('admin:issue',(_,input)=>issueLicense(input?.machineCode,input?.date));
  ipcMain.handle('admin:unbind',async(_,machineHash)=>{
    const {response}=await dialog.showMessageBox(window,{type:'warning',title:'解绑这台机器？',message:'解绑后，这台机器的当前卡密会在下次联网复核时失效。',detail:'离线期间可能继续使用到本地授权到期。解绑后可以重新签发。',buttons:['取消','确认解绑'],defaultId:0,cancelId:0,noLink:true});
    if(response!==1)return null;
    return unbindLicense(machineHash);
  });
  ipcMain.handle('admin:copy',(_,value)=>{clipboard.writeText(String(value||''));return true;});
  window=new BrowserWindow({width:1040,height:760,minWidth:850,minHeight:620,backgroundColor:'#eef2f8',title:'画境 · 卡密管理',icon:path.join(__dirname,'..','assets','logo.ico'),autoHideMenuBar:true,
    webPreferences:{preload:path.join(__dirname,'admin-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.loadFile(path.join(__dirname,'admin-ui','index.html'));
});
app.on('window-all-closed',()=>app.quit());
