const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('licenseAdmin',{
  status:()=>ipcRenderer.invoke('admin:status'),
  setup:input=>ipcRenderer.invoke('admin:setup',input),
  unlock:password=>ipcRenderer.invoke('admin:unlock',password),
  lock:()=>ipcRenderer.invoke('admin:lock'),
  list:()=>ipcRenderer.invoke('admin:list'),
  history:()=>ipcRenderer.invoke('admin:history'),
  ownMachine:()=>ipcRenderer.invoke('admin:own-machine'),
  issue:input=>ipcRenderer.invoke('admin:issue',input),
  rename:input=>ipcRenderer.invoke('admin:rename',input),
  unbind:machineHash=>ipcRenderer.invoke('admin:unbind',machineHash),
  copy:value=>ipcRenderer.invoke('admin:copy',value)
});
