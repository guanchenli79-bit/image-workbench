const test=require('node:test');
const assert=require('node:assert/strict');
const {cleanApiKey,planScenarios,routeFor}=require('../src/diagnostics.cjs');

test('接口检查修正常见密钥前缀并拒绝中文提示词充当密钥',()=>{
  assert.deepEqual(cleanApiKey('  Bearer sk-example123  '),{token:'sk-example123',removedBearer:true});
  assert.throws(()=>cleanApiKey('给参考图人物换装'),/API Key 含中文/);
});

test('诊断计划覆盖文字、图片与视频调用方式，不需要实际参考文件',()=>{
  const models=[
    {id:'chat',type:'text',supported:true},
    {id:'draw',type:'image',accept:['image'],supported:true},
    {id:'movie',type:'video',accept:['image','audio','video'],supported:true}
  ];
  const planned=planScenarios(models);
  assert.equal(planned.find(x=>x.id==='image-video').status,'ready');
  assert.equal(planned.find(x=>x.id==='reference-video').status,'ready');
  assert.equal(planned.find(x=>x.id==='reference-video').route,'POST /v1/videos');
});

test('静态诊断路线与实际适配器使用的端点一致',()=>{
  assert.equal(routeFor({type:'text',adapter:'chat-completions'},{}),'POST /v1/chat/completions');
  assert.equal(routeFor({type:'image',adapter:'grsai-image'},{}),'POST /v1/api/generate');
  assert.equal(routeFor({type:'image',adapter:'legacy-images'},{reference:'image'}),'POST /v1/images/edits');
  assert.equal(routeFor({type:'image',adapter:'images',id:'gpt-image-2-vip'},{reference:'image'}),'POST /v1/images/generations/async');
  assert.equal(routeFor({type:'video',adapter:'grsai-video'},{}),'POST /v1/api/generate');
  assert.equal(routeFor({type:'video',adapter:'video'},{}),'POST /v1/videos');
});
