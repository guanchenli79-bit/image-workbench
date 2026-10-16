const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {imageModels,presets}=require('../src/catalog.cjs');
const {autoRatio,resolveSize}=require('../src/sizing.cjs');
const {normalizeBase,requestJson}=require('../src/api.cjs');

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
