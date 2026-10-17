const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('licenseAdmin',{
  list:()=>ipcRenderer.invoke('admin:list'),
  ownMachine:()=>ipcRenderer.invoke('admin:own-machine'),
  issue:input=>ipcRenderer.invoke('admin:issue',input),
  unbind:machineHash=>ipcRenderer.invoke('admin:unbind',machineHash),
  copy:value=>ipcRenderer.invoke('admin:copy',value)
});
