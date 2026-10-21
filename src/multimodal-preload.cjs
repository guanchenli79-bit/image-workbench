const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('studio',{
  init:()=>ipcRenderer.invoke('init'),saveSettings:data=>ipcRenderer.invoke('settings:save',data),syncModels:()=>ipcRenderer.invoke('models:sync'),
  diagnoseConnection:data=>ipcRenderer.invoke('diagnostics:check',data),
  chooseFiles:()=>ipcRenderer.invoke('files:choose'),addFiles:files=>ipcRenderer.invoke('files:add',files),removeFile:id=>ipcRenderer.invoke('files:remove',id),filePreview:id=>ipcRenderer.invoke('files:preview',id),
  submit:data=>ipcRenderer.invoke('submit',data),history:()=>ipcRenderer.invoke('history:list'),saveResult:(id,index)=>ipcRenderer.invoke('history:save',id,index),clearHistory:()=>ipcRenderer.invoke('history:clear'),
  copyText:value=>ipcRenderer.invoke('clipboard:write-text',value),copyImage:(id,index)=>ipcRenderer.invoke('history:copy-image',id,index),
  submitApplication:data=>ipcRenderer.invoke('approval:submit',data),refreshApplication:()=>ipcRenderer.invoke('approval:refresh'),copyMachineCode:()=>ipcRenderer.invoke('license:copy-machine'),
  checkUpdates:()=>ipcRenderer.invoke('updates:check'),downloadUpdate:()=>ipcRenderer.invoke('updates:download'),installUpdate:()=>ipcRenderer.invoke('updates:install'),
  onLicense:fn=>ipcRenderer.on('license:status',(_,data)=>fn(data)),onUpdate:fn=>ipcRenderer.on('update:status',(_,data)=>fn(data)),onWallpaper:fn=>ipcRenderer.on('wallpaper:changed',(_,data)=>fn(data)),
  onModels:fn=>ipcRenderer.on('models:changed',(_,data)=>fn(data)),onHistory:fn=>ipcRenderer.on('history:changed',(_,data)=>fn(data)),onChatProgress:fn=>ipcRenderer.on('chat:progress',(_,data)=>fn(data)),onNotice:fn=>ipcRenderer.on('notice',(_,data)=>fn(data))
});
