const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {providerFor,parseGrsaiPage,grsaiSpec,imageListFromModels,syncImageModels}=require('../src/providers.cjs');
const {generateImage,queryTask}=require('../src/api.cjs');
const {resolveSize}=require('../src/sizing.cjs');

const pageModels=[
  {name:'gpt-image-2',type:'image',closeModel:false,desc:'支持1K'},
  {name:'gpt-image-2-vip',type:'image',closeModel:false,desc:'支持1K、2K、4K'},
  {name:'nano-banana-2-cl',type:'image',closeModel:false,desc:'支持1K'},
  {name:'gpt-image-2.5-flare',type:'image',closeModel:true,desc:'维护中'},
  {name:'some-video',type:'video',closeModel:false}
];
const page='<script>self.__next_f.push([1,'+JSON.stringify('7:["$",{"models":'+JSON.stringify(pageModels)+'}]')+'])</script>';

test('按端口识别服务商，Grsai 官方页只同步开放的生图模型',async()=>{
  assert.equal(providerFor('https://grsaiapi.com'),'grsai');
  assert.equal(providerFor('https://grsai.dakka.com.cn'),'grsai');
  assert.equal(providerFor('https://www.geeknow.top'),'geeknow');
  assert.equal(providerFor('https://relay.example.com'),'openai-compatible');
  assert.equal(parseGrsaiPage(page).length,5);
  const result=await syncImageModels({baseUrl:'https://grsaiapi.com',apiKey:'key'},async()=>({ok:true,text:async()=>page}));
  assert.deepEqual(result.models.map(x=>x.id),['gpt-image-2','gpt-image-2-vip','nano-banana-2-cl']);
  assert.equal(result.models[1].quality,'medium');
  assert.deepEqual(result.models[1].resolutions,['1K','2K','4K']);
});

test('标准模型列表保留可识别模型，未知模型提示需要适配',()=>{
  const known=imageListFromModels({data:[{id:'gpt-image-2-vip'},{id:'text-chat'},{id:'new-image-thing'}]},'geeknow');
  assert.deepEqual(known.models.map(x=>x.id),['gpt-image-2-vip']);
  assert.equal(known.unsupportedCount,1);
  assert.throws(()=>imageListFromModels({data:[{id:'new-image-thing'}]},'openai-compatible'),/需要适配/);
  assert.deepEqual(imageListFromModels({data:[{id:'gpt-image-1.5'}]},'openai-compatible').models.map(x=>x.adapter),['legacy-images']);
});

test('Grsai GPT Image 2 VIP 参考图按官方字段提交并查询结果',async()=>{
  let submitted=null,queryCount=0;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.url==='/v1/api/generate'){
      assert.equal(req.headers.authorization,'Bearer grsai-test-key');
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      submitted=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.end(JSON.stringify({id:'grs-task-1',status:'running'}));
    }else if(req.url==='/v1/api/result?id=grs-task-1'){
      queryCount++;
      res.end(JSON.stringify(queryCount===1?{id:'grs-task-1',status:'running',progress:36}:
        {id:'grs-task-1',status:'succeeded',results:[{url:'https://example.com/image.png'}]}));
    }else{res.statusCode=404;res.end('{}');}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const baseUrl='http://127.0.0.1:'+server.address().port;
    const model=grsaiSpec({name:'gpt-image-2-vip',type:'image',closeModel:false,desc:'支持1K、2K、4K'});
    const settings={baseUrl,apiKey:'grsai-test-key'};
    const sizing=resolveSize(model,'16:9','风景',null,'2K');
    assert.equal(sizing.size,'2048x1152');
    const references=[1,2,3].map(i=>({mime:'image/png',buffer:Buffer.from('reference-'+i)}));
    const result=await generateImage(settings,{prompt:'风景'},model,sizing,references);
    assert.equal(result.taskAdapter,'grsai-image');
    assert.equal(submitted.aspectRatio,'2048x1152');
    assert.equal(submitted.quality,'medium');
    assert.equal(submitted.replyType,'async');
    assert.equal(submitted.images.length,3);
    assert.ok(submitted.images.every(x=>x.startsWith('data:image/png;base64,')));
    assert.equal((await queryTask(settings,'grsai-image',result.taskId,'image')).progress,36);
    assert.equal((await queryTask(settings,'grsai-image',result.taskId,'image')).items[0].url,'https://example.com/image.png');
    const basic=grsaiSpec({name:'gpt-image-2',type:'image',closeModel:false,desc:'支持1K'});
    await generateImage(settings,{prompt:'无参考图'},basic,resolveSize(basic,'1:1','',null,'1K'),[]);
    assert.deepEqual(submitted.images,[]);
    assert.equal(submitted.aspectRatio,'1:1');
    assert.equal(submitted.quality,'auto');
    const nano=grsaiSpec({name:'nano-banana-2-cl',type:'image',closeModel:false,desc:'支持1K'});
    await generateImage(settings,{prompt:'海边'},nano,resolveSize(nano,'16:9','',null,'1K'),[]);
    assert.equal(submitted.aspectRatio,'16:9');
    assert.equal(submitted.imageSize,'1K');
    assert.equal('quality' in submitted,false);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('标准 GPT Image 兼容端口使用受支持的尺寸并接收 Base64 图片',async()=>{
  let submitted;
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    submitted=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({data:[{b64_json:Buffer.from('png').toString('base64')}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const model=imageListFromModels({data:[{id:'gpt-image-1'}]},'openai-compatible').models[0];
    const result=await generateImage({baseUrl:'http://127.0.0.1:'+server.address().port,apiKey:'test'},
      {prompt:'test'},model,resolveSize(model,'3:2','',null,'default'),[]);
    assert.equal(submitted.size,'1536x1024');
    assert.equal('response_format' in submitted,false);
    assert.equal(result.items[0].b64,Buffer.from('png').toString('base64'));
  }finally{await new Promise(resolve=>server.close(resolve));}
});
