const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const net=require('node:net');
const {imageModels,presets}=require('../src/catalog.cjs');
const {autoRatio,resolveSize}=require('../src/sizing.cjs');
const {normalizeBase,requestJson,generateImage,queryTask}=require('../src/api.cjs');
const {recoverSubmittedMidjourney}=require('../src/recovery.cjs');
const {releaseNotesText}=require('../src/update-notes.cjs');
const {prepareReference}=require('../src/references.cjs');

test('更新弹窗能展示多个版本的说明并清理 HTML 标记',()=>{
  const notes=releaseNotesText([{version:'0.1.6',note:'<h2>新增</h2><ul><li>并行任务</li><li>图片放大</li></ul>'},{version:'0.1.5',note:'## 修复\n- Midjourney 参考图'}]);
  assert.match(notes,/v0\.1\.6\n新增\n• 并行任务/);
  assert.match(notes,/v0\.1\.5\n修复\n- Midjourney 参考图/);
  assert.doesNotMatch(notes,/<[^>]+>/);
});

test('用户要求的 auto 和 13 个固定画幅全部存在',()=>{
  assert.deepEqual(presets.map(x=>x.dimensions),['auto','1024x1024','1672x941','941x1672','1443x1090','1090x1443','1536x1024','1024x1536','1408x1120','1120x1408','1920x832','832x1920','1792x896','896x1792']);
});
test('auto 优先参考图，其次提示词',()=>{
  assert.equal(autoRatio('横版风景',{width:1000,height:1800}),'9:16');
  assert.equal(autoRatio('电影感横屏',null),'16:9');
  assert.equal(autoRatio('山水画',null),'1:1');
});
test('模型尺寸适配不提交其不支持的画幅',()=>{
  const gpt=imageModels.find(x=>x.id==='gpt-image-2');
  const result=resolveSize(gpt,'5:4','',null);
  assert.equal(result.ratio,'4:3');
  assert.equal(result.size,'1536x1152');
  assert.equal(result.adjusted,true);
  const gemini=imageModels.find(x=>x.id==='gemini-3-pro-image-preview');
  assert.equal(resolveSize(gemini,'16:9','',null).ratio,'16:9');
  const pro=imageModels.find(x=>x.id==='gpt-image-2-pro');
  assert.equal(resolveSize(pro,'3:4','',null).size,'1536x2048');
});
test('API Key 用 Bearer 头发送到指定基础地址',async()=>{
  const server=http.createServer((req,res)=>{assert.equal(req.url,'/v1/models');assert.equal(req.headers.authorization,'Bearer test-key');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({object:'list',data:[]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const data=await requestJson({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test-key'},'/v1/models');assert.equal(data.object,'list');}
  finally{await new Promise(resolve=>server.close(resolve));}
});
test('远程 HTTP 接口不可接收 API Key',()=>assert.throws(()=>normalizeBase('http://example.com'),/HTTPS/));
test('参考图检查实际文件格式，避免把错误数据交给图像接口',()=>{
  const png=Buffer.from([137,80,78,71,13,10,26,10,0]);
  assert.equal(prepareReference('sample.PNG',png).mime,'image/png');
  assert.throws(()=>prepareReference('sample.png',Buffer.from('not an image')),/不是有效/);
  assert.throws(()=>prepareReference('sample.gif',png),/仅支持/);
});
test('GPT Image 2 VIP 三张参考图先上传，再以原顺序的 URL 提交异步任务',async()=>{
  const uploads=[];let submitted;
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const raw=Buffer.concat(chunks);
    res.setHeader('Content-Type','application/json');
    const base=`http://127.0.0.1:${server.address().port}`;
    if(req.url==='/api/upload/presign'){
      const body=JSON.parse(raw.toString());
      const index=Number(body.file_name.match(/\d+/)[0]);
      res.end(JSON.stringify({success:true,data:{upload_url:`${base}/upload/${index}`,public_url:`${base}/public/${index}`}}));
    }else if(req.url.startsWith('/upload/')){
      uploads.push({index:Number(req.url.split('/').pop()),mime:req.headers['content-type'],body:raw.toString()});res.end('{}');
    }else if(req.url==='/v1/images/generations/async'){
      submitted=JSON.parse(raw.toString());res.end(JSON.stringify({id:'vip-task-123',status:'queued'}));
    }else{res.statusCode=404;res.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const refs=[1,2,3].map(index=>({name:`ref-${index}.png`,mime:'image/png',buffer:Buffer.from(`image-${index}`)}));
    const result=await generateImage({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test'},
      {prompt:'参考这三张图'}, {id:'gpt-image-2-vip',adapter:'images'}, {size:'1024x1024'},refs);
    assert.deepEqual(result,{kind:'task',taskId:'vip-task-123',taskAdapter:'image-async'});
    assert.deepEqual(uploads.sort((a,b)=>a.index-b.index).map(item=>item.body),['image-1','image-2','image-3']);
    assert.deepEqual(submitted.image,[1,2,3].map(index=>`http://127.0.0.1:${server.address().port}/public/${index}`));
    assert.equal(submitted.model,'gpt-image-2-vip');
    assert.equal(submitted.size,'1024x1024');
    const other=await generateImage({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test'},
      {prompt:'参考图片'}, {id:'gpt-image-2',adapter:'images'}, {size:'1024x1024'},refs.slice(0,1));
    assert.equal(other.taskAdapter,'image-async');
    assert.equal(submitted.model,'gpt-image-2');
    assert.equal(submitted.image.length,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('异步生图查询识别百分比、无 status 的成品和失败原因',async()=>{
  let response={status:'in_progress',progress:'38%'};
  const server=http.createServer((req,res)=>{assert.equal(req.url,'/v1/images/generations/async/vip-task-123');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const settings={baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test'};
  try{
    assert.deepEqual(await queryTask(settings,'image-async','vip-task-123','image'),{status:'pending',progress:38});
    response={data:[{url:'https://example.com/generated.png'}]};
    assert.deepEqual(await queryTask(settings,'image-async','vip-task-123','image'),{status:'complete',items:[{url:'https://example.com/generated.png',b64:undefined,mime:'image/png'}]});
    response={status:'failed',error:{message:'上游生成失败'}};
    assert.deepEqual(await queryTask(settings,'image-async','vip-task-123','image'),{status:'failed',error:'上游生成失败'});
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('Midjourney 的纯文本 JSON 提交成功响应会保留任务 ID',async()=>{
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/plain');res.end(JSON.stringify({code:1,description:'Submit success',result:'1792115316238633'}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const result=await generateImage({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test'}, {prompt:'山海'}, {adapter:'midjourney'}, {ratio:'1:1'}, []);
    assert.deepEqual(result,{kind:'task',taskId:'1792115316238633',taskAdapter:'midjourney'});
  } finally {await new Promise(resolve=>server.close(resolve));}
});
test('Midjourney 多张参考图先逐张上传，再用 URL 提交单次 Imagine',async()=>{
  const uploads=[];let imagineCount=0;
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const body=JSON.parse(Buffer.concat(chunks).toString());
    res.setHeader('Content-Type','application/json');
    if(req.url==='/mj/submit/upload-discord-images'){
      assert.equal(body.base64Array.length,1);
      assert.match(body.base64Array[0],/^data:image\/png;base64,/);
      uploads.push(body.base64Array[0]);
      res.end(JSON.stringify({code:1,result:[`https://cdn.example.com/ref-${uploads.length}.png`]}));
    }else if(req.url==='/mj/submit/imagine'){
      imagineCount++;
      assert.deepEqual(body.base64Array,[]);
      assert.equal(body.prompt,'https://cdn.example.com/ref-1.png https://cdn.example.com/ref-2.png 描述 --ar 3:4');
      res.end(JSON.stringify({code:1,result:'task-123'}));
    }else{res.statusCode=404;res.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const refs=[1,2].map(n=>({mime:'image/png',buffer:Buffer.from(`image-${n}`)}));
    const result=await generateImage({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test'},{prompt:'描述'},{adapter:'midjourney'},{ratio:'3:4'},refs);
    assert.equal(result.taskId,'task-123');assert.equal(uploads.length,2);assert.equal(imagineCount,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('Midjourney 参考图上传失败时不提交 Imagine，也不自动重试',async()=>{
  let imagineCount=0;
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.url==='/mj/submit/imagine')imagineCount++;
    res.end(JSON.stringify({code:4,description:'upload_failed'}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    await assert.rejects(generateImage({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test'},{prompt:'描述'},{adapter:'midjourney'},{ratio:'1:1'},[{mime:'image/png',buffer:Buffer.from('image')}]),/第 1 张参考图上传失败/);
    assert.equal(imagineCount,0);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('上游安全拒绝保留请求 ID，并提供可操作提示',async()=>{
  const id='b42bb6e-3d87-4906-a3c3-4cc5757184ab';
  const server=http.createServer((req,res)=>{res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:{message:`Your request was rejected by the safety system. If you believe this is an error, contact us at Azure support ticket and include the request ID ${id}.`}}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await assert.rejects(requestJson({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test'},'/v1/images/generations'),error=>/上游安全系统拒绝/.test(error.message)&&error.message.includes(id));}
  finally{await new Promise(resolve=>server.close(resolve));}
});
test('Midjourney 任务查询可解析纯文本 JSON',async()=>{
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/plain');res.end(JSON.stringify({status:'SUCCESS',imageUrl:'https://example.com/result.png'}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const result=await queryTask({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test'},'midjourney','1792115316238633','image');
    assert.equal(result.status,'complete');assert.equal(result.items[0].url,'https://example.com/result.png');
  } finally {await new Promise(resolve=>server.close(resolve));}
});
test('误判失败的 Midjourney 提交可恢复为待查询任务',()=>{
  const records=[{status:'failed',modelId:'midjourney',error:JSON.stringify({code:1,description:'Submit success',result:'1792115316238633'})}];
  assert.equal(recoverSubmittedMidjourney(records),1);
  assert.equal(records[0].status,'pending');assert.equal(records[0].taskId,'1792115316238633');
  assert.equal(records[0].error,undefined);
});
test('请求会经过 HTTP_PROXY 指定的代理',async()=>{
  const target=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[]}));});
  const proxy=http.createServer();
  let proxied=false;
  proxy.on('connect',(req,client,head)=>{
    proxied=true;
    const [host,port]=req.url.split(':');
    const upstream=net.connect(Number(port),host,()=>{client.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);client.pipe(upstream);upstream.pipe(client);});
    upstream.on('error',()=>client.destroy());client.on('error',()=>upstream.destroy());
  });
  await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  try {
    const old={HTTP_PROXY:process.env.HTTP_PROXY,HTTPS_PROXY:process.env.HTTPS_PROXY,NO_PROXY:process.env.NO_PROXY};
    const modulePath=require.resolve('../src/network.cjs');
    try {
      process.env.HTTP_PROXY=`http://127.0.0.1:${proxy.address().port}`;
      process.env.HTTPS_PROXY=process.env.HTTP_PROXY;process.env.NO_PROXY='';
      delete require.cache[modulePath];
      const {networkFetch}=require('../src/network.cjs');
      const response=await networkFetch(`http://127.0.0.1:${target.address().port}/v1/models`);
      assert.equal(response.status,200);assert.equal(proxied,true);
    } finally {
      for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
      delete require.cache[modulePath];
    }
  } finally {proxy.closeAllConnections();target.closeAllConnections();await Promise.all([new Promise(resolve=>proxy.close(resolve)),new Promise(resolve=>target.close(resolve))]);}
});
test('桌面启动无代理环境变量时使用 Electron 系统代理解析器',async()=>{
  const modulePath=require.resolve('../src/network.cjs');
  const electronPath=require.resolve('electron');
  const originalElectron=require.cache[electronPath];
  const previous=process.env.HTTPS_PROXY;
  try {
    delete process.env.HTTPS_PROXY;
    require.cache[electronPath]={id:electronPath,filename:electronPath,loaded:true,exports:{session:{defaultSession:{resolveProxy:async()=> 'PROXY 127.0.0.1:7897; DIRECT'}}}};
    delete require.cache[modulePath];
    const {dispatcherFor}=require('../src/network.cjs');
    const dispatcher=await dispatcherFor('https://www.geeknow.top/v1/models');
    assert.equal(dispatcher.constructor.name,'ProxyAgent');
  } finally {
    if(previous===undefined)delete process.env.HTTPS_PROXY;else process.env.HTTPS_PROXY=previous;
    if(originalElectron)require.cache[electronPath]=originalElectron;else delete require.cache[electronPath];
    delete require.cache[modulePath];
  }
});
