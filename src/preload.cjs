const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('workbench',{
  init:()=>ipcRenderer.invoke('app:init'),
  saveSettings:data=>ipcRenderer.invoke('settings:save',data),
  verifySettings:data=>ipcRenderer.invoke('settings:verify',data),
  resolveSize:data=>ipcRenderer.invoke('size:resolve',data),
  chooseReferences:()=>ipcRenderer.invoke('reference:choose'),
  addReferences:files=>ipcRenderer.invoke('reference:add',files),
  clearReferences:ids=>ipcRenderer.invoke('reference:clear',ids),
  generate:data=>ipcRenderer.invoke('generate',data),
  history:()=>ipcRenderer.invoke('history:list'),
  clearHistory:()=>ipcRenderer.invoke('history:clear'),
  saveResult:(id,index)=>ipcRenderer.invoke('history:save',id,index),
  checkUpdates:()=>ipcRenderer.invoke('updates:check'),
  downloadUpdate:()=>ipcRenderer.invoke('updates:download'),
  installUpdate:()=>ipcRenderer.invoke('updates:install'),
  onNotice:callback=>{const fn=(_,data)=>callback(data);ipcRenderer.on('app:notice',fn);return()=>ipcRenderer.removeListener('app:notice',fn);},
  onHistory:callback=>{const fn=(_,data)=>callback(data);ipcRenderer.on('history:changed',fn);return()=>ipcRenderer.removeListener('history:changed',fn);},
  onUpdate:callback=>{const fn=(_,data)=>callback(data);ipcRenderer.on('update:status',fn);return()=>ipcRenderer.removeListener('update:status',fn);}
});
