const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'image-workbench-resolution-ui-')));
app.disableHardwareAcceleration();
require('../src/main.cjs');

app.whenReady().then(async()=>{
  try{
    let window;
    for(let attempt=0;attempt<50;attempt++){
      window=BrowserWindow.getAllWindows()[0];
      if(window&&!window.webContents.isLoadingMainFrame())break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(!window)throw new Error('桌面窗口未启动');
    const result=await window.webContents.executeJavaScript(`(async()=>{
      const model=document.getElementById('modelSelect');
      const resolution=document.getElementById('resolutionSelect');
      const choose=async(id,tier)=>{
        model.value=id;model.dispatchEvent(new Event('change',{bubbles:true}));
        const choices=[...resolution.options].map(option=>option.value);
        if(tier){resolution.value=tier;resolution.dispatchEvent(new Event('change',{bubbles:true}));}
        await new Promise(resolve=>setTimeout(resolve,120));
        return {choices,selected:resolution.value,note:document.getElementById('resolvedSize').textContent};
      };
      return {vip:await choose('gpt-image-2-vip','4K'),pro:await choose('gpt-image-2-pro'),gemini:await choose('gemini-3-pro-image-preview','1K'),midjourney:await choose('midjourney')};
    })()`);
    console.log(JSON.stringify(result));
    if(result.vip.choices.join(',')!=='1K,2K,4K'||!result.vip.note.includes('2880x2880'))throw new Error('VIP 分辨率选择未生效');
    if(result.pro.choices.join(',')!=='2K,4K'||result.pro.selected!=='2K')throw new Error('Pro 分辨率档位错误');
    if(result.gemini.choices.join(',')!=='1K,2K'||result.gemini.selected!=='1K')throw new Error('Gemini 分辨率档位错误');
    if(result.midjourney.choices.join(',')!=='default')throw new Error('Midjourney 不应显示未支持的档位');
  }catch(error){console.error(error);process.exitCode=1;}
  finally{app.quit();}
});
