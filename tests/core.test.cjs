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
const {resolveRecordParams}=require('../src/renderer/record-params.js');
const {migrateMultimodalHistory}=require('../src/maintenance-migration.cjs');

test('??AI??????????????????????',()=>{
  const converted=migrateMultimodalHistory([
    {id:'image-1',type:'image',status:'complete',prompt:'?',ratio:'16:9',localFiles:['image-1.png'],expiresAt:123},
    {id:'text-1',type:'text',answer:'??',status:'complete'},
    {id:'video-1',type:'video',status:'pending',taskId:'task-1',taskAdapter:'grsai',localFiles:[]}
  ]);
  assert.equal(converted.length,2);
  assert.deepEqual(converted[0].files,['image-1.png']);
  assert.equal(converted[0].actualRatio,'16:9');
  assert.equal(converted[1].taskId,'task-1');
});

test('?????????????????????',()=>{
  const model={id:'gpt-image-2.5',ratios:['1:1','16:9'],resolutions:['1K','2K','4K']};
  const record={modelId:model.id,presetId:'auto',actualRatio:'16:9',resolution:'1k'};
  assert.deepEqual(resolveRecordParams(record,model,[{id:'auto'},{id:'1:1'},{id:'16:9'}]),{ratio:'16:9',resolution:'1K',seconds:null});
});

test('????????????????? HTML ??',()=>{
  const notes=releaseNotesText([{version:'0.1.6',note:'<h2>??</h2><ul><li>????</li><li>????</li></ul>'},{version:'0.1.5',note:'## ??\n- Midjourney ???'}]);
  assert.match(notes,/v0\.1\.6\n??\n? ????/);
  assert.match(notes,/v0\.1\.5\n??\n- Midjourney ???/);
  assert.doesNotMatch(notes,/<[^>]+>/);
});

test('????? auto ? 13 ?????????',()=>{
  assert.deepEqual(presets.map(x=>x.dimensions),['auto','1024x1024','1672x941','941x1672','1443x1090','1090x1443','1536x1024','1024x1536','1408x1120','1120x1408','1920x832','832x1920','1792x896','896x1792']);
});
test('auto ???????????',()=>{
  assert.equal(autoRatio('????',{width:1000,height:1800}),'9:16');
  assert.equal(autoRatio('?????',null),'16:9');
  assert.equal(autoRatio('???',null),'1:1');
});
test('????????????????',()=>{
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
test('???????????????????????',()=>{
  const vip=imageModels.find(x=>x.id==='gpt-image-2-vip');
  assert.deepEqual(vip.resolutions,['1K','2K','4K']);
  assert.equal(resolveSize(vip,'16:9','',null,'1K').size,'1280x720');
  assert.equal(resolveSize(vip,'16:9','',null,'2K').size,'2560x1440');
  assert.equal(resolveSize(vip,'16:9','',null,'4K').size,'3840x2160');
  assert.throws(()=>resolveSize(vip,'16:9','',null,'8K'),/???/);
  const pro=imageModels.find(x=>x.id==='gpt-image-2-pro');
  assert.deepEqual(pro.resolutions,['2K','4K']);
  assert.equal(resolveSize(pro,'1:1','',null,'4K').size,'2880x2880');
  const gemini=imageModels.find(x=>x.id==='gemini-3-pro-image-preview');
  assert.equal(resolveSize(gemini,'1:1','',null).resolution,'2K');
  assert.equal(resolveSize(gemini,'1:1','',null,'1K').resolution,'1K');
  assert.deepEqual(imageModels.find(x=>x.id==='midjourney').resolutions,['default']);
});
test('????????????????????????',()=>{
  for (const model of imageModels) {
    for (const resolution of model.resolutions) {
      for (const ratio of model.ratios) {
        const result=resolveSize(model,ratio,'',null,resolution);
        assert.equal(result.resolution,resolution,`${model.id} ${resolution}`);
        if (model.adapter !== 'gemini' && model.adapter !== 'midjourney') {
          assert.match(result.size,/^\d+x\d+$/,`${model.id} ${resolution} ${ratio}`);
        }
      }
    }
  }
});
test('Gemini ??????????????',async()=>{
  let submitted;
  const server=http.createServer(async(req,res)=>{
    submitted=JSON.parse(await new Promise(resolve=>{let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>resolve(body));}));
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:'image/png',data:Buffer.from('png').toString('base64')}}]}}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const model=imageModels.find(x=>x.id==='gemini-3-pro-image-preview');
    await generateImage({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test'},{prompt:'??'},model,resolveSize(model,'16:9','',null,'1K'),[]);
    assert.equal(submitted.generationConfig.imageConfig.imageSize,'1K');
    assert.equal(submitted.generationConfig.imageConfig.aspectRatio,'16:9');
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('API Key ? Bearer ??????????',async()=>{
  const server=http.createServer((req,res)=>{assert.equal(req.url,'/v1/models');assert.equal(req.headers.authorization,'Bearer test-key');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({object:'list',data:[]}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const data=await requestJson({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test-key'},'/v1/models');assert.equal(data.object,'list');}
  finally{await new Promise(resolve=>server.close(resolve));}
});
test('?? HTTP ?????? API Key',()=>assert.throws(()=>normalizeBase('http://example.com'),/HTTPS/));
test('?????????????????????????',()=>{
  const png=Buffer.from([137,80,78,71,13,10,26,10,0]);
  assert.equal(prepareReference('sample.PNG',png).mime,'image/png');
  assert.throws(()=>prepareReference('sample.png',Buffer.from('not an image')),/????/);
  assert.throws(()=>prepareReference('sample.gif',png),/???/);
});
test('GPT Image 2 VIP ??????????????? URL ??????',async()=>{
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
      {prompt:'??????'}, {id:'gpt-image-2-vip',adapter:'images'}, {size:'1024x1024'},refs);
    assert.deepEqual(result,{kind:'task',taskId:'vip-task-123',taskAdapter:'image-async'});
    assert.deepEqual(uploads.sort((a,b)=>a.index-b.index).map(item=>item.body),['image-1','image-2','image-3']);
    assert.deepEqual(submitted.image,[1,2,3].map(index=>`http://127.0.0.1:${server.address().port}/public/${index}`));
    assert.equal(submitted.model,'gpt-image-2-vip');
    assert.equal(submitted.size,'1024x1024');
    const other=await generateImage({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test'},
      {prompt:'????'}, {id:'gpt-image-2',adapter:'images'}, {size:'1024x1024'},refs.slice(0,1));
    assert.equal(other.taskAdapter,'image-async');
    assert.equal(submitted.model,'gpt-image-2');
    assert.equal(submitted.image.length,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('????????????? status ????????',async()=>{
  let response={status:'in_progress',progress:'38%'};
  const server=http.createServer((req,res)=>{assert.equal(req.url,'/v1/images/generations/async/vip-task-123');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(response));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const settings={baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test'};
  try{
    assert.deepEqual(await queryTask(settings,'image-async','vip-task-123','image'),{status:'pending',progress:38});
    response={data:[{url:'https://example.com/generated.png'}]};
    assert.deepEqual(await queryTask(settings,'image-async','vip-task-123','image'),{status:'complete',items:[{url:'https://example.com/generated.png',b64:undefined,mime:'image/png'}]});
    response={status:'failed',error:{message:'??????'}};
    assert.deepEqual(await queryTask(settings,'image-async','vip-task-123','image'),{status:'failed',error:'??????'});
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('Midjourney ???? JSON ??????????? ID',async()=>{
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/plain');res.end(JSON.stringify({code:1,description:'Submit success',result:'1792115316238633'}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const result=await generateImage({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test'}, {prompt:'??'}, {adapter:'midjourney'}, {ratio:'1:1'}, []);
    assert.deepEqual(result,{kind:'task',taskId:'1792115316238633',taskAdapter:'midjourney'});
  } finally {await new Promise(resolve=>server.close(resolve));}
});
test('Midjourney ????????????? URL ???? Imagine',async()=>{
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
      assert.equal(body.prompt,'https://cdn.example.com/ref-1.png https://cdn.example.com/ref-2.png ?? --ar 3:4');
      res.end(JSON.stringify({code:1,result:'task-123'}));
    }else{res.statusCode=404;res.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const refs=[1,2].map(n=>({mime:'image/png',buffer:Buffer.from(`image-${n}`)}));
    const result=await generateImage({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test'},{prompt:'??'},{adapter:'midjourney'},{ratio:'3:4'},refs);
    assert.equal(result.taskId,'task-123');assert.equal(uploads.length,2);assert.equal(imagineCount,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('Midjourney ??????????? Imagine???????',async()=>{
  let imagineCount=0;
  const server=http.createServer((req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.url==='/mj/submit/imagine')imagineCount++;
    res.end(JSON.stringify({code:4,description:'upload_failed'}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    await assert.rejects(generateImage({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test'},{prompt:'??'},{adapter:'midjourney'},{ratio:'1:1'},[{mime:'image/png',buffer:Buffer.from('image')}]),/? 1 ????????/);
    assert.equal(imagineCount,0);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('?????????? ID?????????',async()=>{
  const id='b42bb6e-3d87-4906-a3c3-4cc5757184ab';
  const server=http.createServer((req,res)=>{res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:{message:`Your request was rejected by the safety system. If you believe this is an error, contact us at Azure support ticket and include the request ID ${id}.`}}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{await assert.rejects(requestJson({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test'},'/v1/images/generations'),error=>/????????/.test(error.message)&&error.message.includes(id));}
  finally{await new Promise(resolve=>server.close(resolve));}
});
test('Midjourney ?????????? JSON',async()=>{
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/plain');res.end(JSON.stringify({status:'SUCCESS',imageUrl:'https://example.com/result.png'}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const result=await queryTask({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'test'},'midjourney','1792115316238633','image');
    assert.equal(result.status,'complete');assert.equal(result.items[0].url,'https://example.com/result.png');
  } finally {await new Promise(resolve=>server.close(resolve));}
});
test('????? Midjourney ???????????',()=>{
  const records=[{status:'failed',modelId:'midjourney',error:JSON.stringify({code:1,description:'Submit success',result:'1792115316238633'})}];
  assert.equal(recoverSubmittedMidjourney(records),1);
  assert.equal(records[0].status,'pending');assert.equal(records[0].taskId,'1792115316238633');
  assert.equal(records[0].error,undefined);
});
test('????? HTTP_PROXY ?????',async()=>{
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
test('?????? Electron ?????? Windows ??? VPN',async()=>{
  const modulePath=require.resolve('../src/network.cjs');
  const electronPath=require.resolve('electron');
  const originalElectron=require.cache[electronPath];
  const previous=process.env.HTTPS_PROXY;
  try {
    delete process.env.HTTPS_PROXY;
    let requestedUrl='';
    require.cache[electronPath]={id:electronPath,filename:electronPath,loaded:true,exports:{net:{fetch:async url=>{requestedUrl=url;return {status:200};}}}};
    delete require.cache[modulePath];
    const {networkFetch}=require('../src/network.cjs');
    const response=await networkFetch('https://www.geeknow.top/v1/models');
    assert.equal(response.status,200);
    assert.equal(requestedUrl,'https://www.geeknow.top/v1/models');
  } finally {
    if(previous===undefined)delete process.env.HTTPS_PROXY;else process.env.HTTPS_PROXY=previous;
    if(originalElectron)require.cache[electronPath]=originalElectron;else delete require.cache[electronPath];
    delete require.cache[modulePath];
  }
});
