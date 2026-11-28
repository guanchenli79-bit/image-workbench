const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {normalizeRuleSet,previewRule,mergeRules,makeImageRequest,ruleUrl}=require('../src/model-rules.cjs');
const {resolveSize}=require('../src/sizing.cjs');

const baseUrl='https://api.modelgo.ai';
const modelId='doubao-seedream-5.5';
const sample={baseUrl:baseUrl+'/v1',modelId,protocol:'seedream-json',modelsPath:'/v1/models',
  generationPath:'/v1/images/generations',maxRefs:3,watermark:false,
  sizes:{'1K':{'1:1':'1024x1024','16:9':'1280x720'},'2K':{'1:1':'2048x2048','16:9':'2816x1584'}},
  defaultResolution:'2K'};
const config=(rule=sample)=>({schemaVersion:1,rules:[rule]});

test('管理端预览与客户端共用 Seedream 画幅、像素和请求参数',()=>{
  const rules=normalizeRuleSet(config());
  const [model]=mergeRules([], [modelId],rules,baseUrl,true);
  assert.deepEqual(model.resolutions,['1K','2K']);
  assert.deepEqual(model.ratios,['1:1','16:9']);
  const sizing=resolveSize(model,'16:9','图像示例',null,'2K');
  const preview=previewRule(sample,'16:9','2K');
  const actual=makeImageRequest(model.managedRule,{prompt:preview.body.prompt,size:sizing.size});
  assert.equal(preview.url,ruleUrl(baseUrl,actual.path,'generate'));
  assert.equal(sizing.size,'2816x1584');
  assert.deepEqual(preview.body,actual.body);
  assert.deepEqual(makeImageRequest(model.managedRule,{prompt:'图像示例',size:sizing.size,references:['one','two','three']}).body.image,
    ['one','two','three']);
  assert.equal(actual.body.watermark,false);
});

test('规则按已保存地址匹配，并拒绝重定向式路径、越过前缀及错误尺寸',()=>{
  const testRequest=value=>()=>normalizeRuleSet(config(value));
  for(const generationPath of ['https://different.example/v1/images/generations','//different.example/v1/images/generations',
    '/v1/%2e%2e/images/generations','/v1/images/generations?next=elsewhere']){
    assert.throws(testRequest({...sample,generationPath}),/路径格式/);
  }
  assert.throws(testRequest({...sample,baseUrl:baseUrl+'/agency'}),/API 基础地址下/);
  assert.throws(testRequest({...sample,sizes:{'1K':{'16:9':'1024x1024'}}}),/画幅不一致/);
  assert.throws(()=>normalizeRuleSet({schemaVersion:1,rules:[sample,sample]}),/重复/);
  assert.deepEqual(mergeRules([],[],normalizeRuleSet(config()),baseUrl,true),[]);
  const manual=normalizeRuleSet(config({...sample,allowUnlisted:true}));
  assert.deepEqual(mergeRules([],[],manual,'https://elsewhere.example',true),[]);
  assert.deepEqual(mergeRules([],[],manual,baseUrl,false),[]);
  assert.equal(mergeRules([],[],manual,baseUrl,true).length,1);
});

test('审批 Worker 仅给获批设备提供规则，发布推送变更并保护并发，回退产生新版本',async t=>{
  const local=new DatabaseSync(':memory:');
  t.after(()=>local.close());
  local.exec(fs.readFileSync(path.join(__dirname,'../approval-service/schema.sql'),'utf8'));
  local.exec(fs.readFileSync(path.join(__dirname,'../approval-service/migrate-model-rules.sql'),'utf8'));
  const DB={prepare(sql){
    const query=local.prepare(sql);
    const command=(args)=>({
      first:async()=>query.get(...args)||null,
      all:async()=>({results:query.all(...args)}),
      run:async()=>({meta:query.run(...args)})
    });
    return {...command([]),bind:(...args)=>command(args)};
  }};
  const {default:worker}=await import('../approval-service/worker.mjs');
  const notifications=[];
  const pending=[];
  const adminToken='A'.repeat(43);
  const deviceSecret='B'.repeat(43);
  const deviceId='11111111-2222-4333-8444-555555555555';
  const machineCode='DP-M-0123-4567-89AB-CDEF';
  const env={DB,ADMIN_TOKEN:adminToken,ANNOUNCEMENTS:{
    idFromName:name=>name,get:()=>({fetch:async url=>{notifications.push(url);return new Response(null,{status:204});}})
  }};
  const adminHeaders={authorization:'Bearer '+adminToken};
  const deviceHeaders={authorization:'Device '+deviceSecret,'x-device-id':deviceId,'x-machine-code':machineCode,'x-machine-code-version':'2'};
  const request=(pathname,method='GET',headers={},body)=>worker.fetch(
    new Request('https://local.example'+pathname,{method,headers,body:body&&JSON.stringify(body)}),env,
    {waitUntil:promise=>pending.push(promise)});
  const adminPath='/v1/admin/model-rules';
  const clientPath='/v1/model-rules';
  assert.equal((await request(adminPath)).status,401);
  assert.equal((await request(clientPath,'GET',deviceHeaders)).status,403);
  const application=await request('/v1/applications','POST',{},{
    username:'fixture',password:'Test12345',deviceId,deviceSecret,machineCode,machineCodeVersion:2
  });
  assert.equal(application.status,201);
  const {id}=await application.json();
  assert.equal((await request('/v1/admin/applications/'+id+'/approve','POST',adminHeaders,
    {expiresAt:new Date(Date.now()+86_400_000).toISOString()})).status,200);
  assert.equal((await (await request(clientPath,'GET',deviceHeaders)).json()).manifest.revision,0);
  const wrongDevice={...deviceHeaders,authorization:'Device '+adminToken};
  assert.equal((await request(clientPath,'GET',wrongDevice)).status,403);
  const first=await request(adminPath,'POST',adminHeaders,{expectedRevision:0,config:config()});
  assert.equal(first.status,201);
  const changed={...sample,sizes:{...sample.sizes,'2K':{'1:1':'2048x2048','16:9':'2560x1440'}}};
  const updates=await Promise.all([changed,changed].map(rule=>request(adminPath,'POST',adminHeaders,{expectedRevision:1,config:config(rule)})));
  assert.deepEqual(updates.map(response=>response.status).sort(),[201,409]);
  assert.equal((await (await request(clientPath,'GET',deviceHeaders)).json()).manifest.config.rules[0].sizes['2K']['16:9'],'2560x1440');
  const rollback=await request(adminPath+'/rollback','POST',adminHeaders,{expectedRevision:2,targetRevision:1});
  assert.equal(rollback.status,201);
  const {manifest,history}=await rollback.json();
  assert.equal(manifest.revision,3);
  assert.equal(manifest.rollbackOf,1);
  assert.equal(manifest.config.rules[0].sizes['2K']['16:9'],'2816x1584');
  assert.deepEqual(history.map(item=>item.revision),[3,2,1]);
  await Promise.all(pending);
  assert.deepEqual(notifications,Array(3).fill('https://internal/notify-model-rules'));
});
