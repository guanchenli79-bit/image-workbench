const {app,safeStorage}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const {generateImage,queryTask,requestJson}=require('../src/api.cjs');
const {resolveSize}=require('../src/sizing.cjs');
const {imageModels}=require('../src/catalog.cjs');
const {prepareReference}=require('../src/references.cjs');
const {networkFetch}=require('../src/network.cjs');

delete process.env.HTTP_PROXY;
delete process.env.HTTPS_PROXY;
delete process.env.http_proxy;
delete process.env.https_proxy;
app.setName('image-workbench');
app.setPath('userData',path.join(app.getPath('appData'),'image-workbench'));
app.disableHardwareAcceleration();

app.whenReady().then(async()=>{
  try{
    const saved=JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'settings.json'),'utf8'));
    const apiKey=safeStorage.decryptString(Buffer.from(saved.apiKey,'base64'));
    if(!apiKey)throw new Error('本机没有可用的 API Key');
    const settings={baseUrl:saved.baseUrl,apiKey};
    await requestJson(settings,'/v1/models',{signal:AbortSignal.timeout(30000)});
    console.log('API Key 已验证');
    const sourceImage=await fs.readFile(path.join(__dirname,'../assets/logo.png'));
    const references=[1,2,3].map(index=>prepareReference(`reference-${index}.png`,sourceImage));
    const model=imageModels.find(item=>item.id==='gpt-image-2-vip');
    const prompt='参考提供的三张图的简洁视觉风格，创作一张精致的抽象创作空间插画，柔和光线，不要文字。';
    const sizing=resolveSize(model,'1:1',prompt);
    const result=await generateImage(settings,{prompt},model,sizing,references);
    console.log(`VIP 三图任务提交结果：${result.kind}`);
    let items=result.items;
    if(result.kind==='task'){
      for(let attempt=0;attempt<60;attempt++){
        await new Promise(resolve=>setTimeout(resolve,5000));
        const status=await queryTask(settings,result.taskAdapter,result.taskId,'image');
        if(status.status==='failed')throw new Error(status.error);
        if(status.status==='complete'){items=status.items;break;}
        if(attempt%3===0)console.log(`任务进度：${status.progress}%`);
      }
    }
    if(!items?.length)throw new Error('五分钟内没有获得图片');
    const item=items[0];
    let bytes;
    if(item.b64)bytes=Buffer.from(item.b64.replace(/^data:[^,]+,/i,''),'base64');
    else{
      const url=new URL(item.url);
      const response=await networkFetch(url,{headers:url.origin===new URL(settings.baseUrl).origin?{Authorization:`Bearer ${apiKey}`}:{},signal:AbortSignal.timeout(90000)});
      if(!response.ok)throw new Error(`图片下载失败：HTTP ${response.status}`);
      bytes=Buffer.from(await response.arrayBuffer());
    }
    if(bytes.length<1024)throw new Error('返回图片文件异常小');
    const extension=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':bytes[0]===255&&bytes[1]===216?'jpg':null;
    if(!extension)throw new Error('返回内容不是可识别的 PNG/JPEG 图片');
    await fs.writeFile(path.join(__dirname,`../release/live-vip-three-references.${extension}`),bytes);
    console.log(`三张参考图真实生成成功，图片大小 ${bytes.length} 字节`);
  }catch(error){console.error(`真实验证失败：${error.message}`);process.exitCode=1;}
  finally{app.quit();}
});
