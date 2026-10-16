const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const testData=fs.mkdtempSync(path.join(os.tmpdir(),'image-workbench-reference-ui-'));
app.setPath('userData',testData);
app.disableHardwareAcceleration();
require('../src/main.cjs');

app.whenReady().then(async()=>{
  try{
    let window;
    for(let attempt=0;attempt<50;attempt++){
      window=BrowserWindow.getAllWindows()[0];
      if(window && !window.webContents.isLoadingMainFrame())break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!window)throw new Error('桌面窗口未启动');
    const png=fs.readFileSync(path.join(__dirname,'../assets/logo.png')).toString('base64');
    const result=await window.webContents.executeJavaScript(`(async()=>{
      const bytes=Uint8Array.from(atob('${png}'),char=>char.charCodeAt(0));
      const transfer=new DataTransfer();
      transfer.items.add(new File([bytes],'dragged-logo.png',{type:'image/png'}));
      document.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer}));
      const highlighted=document.getElementById('addReference').classList.contains('drag-active');
      document.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
      await new Promise(resolve=>setTimeout(resolve,1200));
      const preview=document.querySelector('#referenceList img');
      preview?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
      return {highlighted,referenceCount:document.querySelectorAll('#referenceList .reference-card').length,previewOpen:document.getElementById('imagePreviewDialog').open,title:document.getElementById('imagePreviewTitle').textContent,toast:document.getElementById('toast').textContent};
    })()`);
    console.log(JSON.stringify(result));
    if(!result.highlighted||result.referenceCount!==1||!result.previewOpen||!result.title.includes('dragged-logo.png'))throw new Error('参考图交互验证失败');
  }catch(error){console.error(error);process.exitCode=1;}
  finally{app.quit();}
});
