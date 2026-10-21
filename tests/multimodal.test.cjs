const test=require('node:test');
const assert=require('node:assert/strict');
const {entryFor,modelsFromStandard,allowedFile}=require('../src/multimodal.cjs');

test('标准列表按已知能力分到文本、图像和视频',()=>{
  const models=modelsFromStandard({data:[{id:'gpt-4o'},{id:'gpt-image-1'},{id:'sora-2'},{id:'mystery-123'}]},'geeknow');
  assert.deepEqual(models.map(x=>x.type),['text','image','video','unknown']);
  assert.equal(models[0].supported,true);
  assert.equal(models[2].supported,true);
  assert.equal(models[3].supported,false);
});
test('未知视频端口保留模型但阻止未经确认的提交',()=>{
  const model=entryFor({id:'seedance-2.5'},'openai-compatible');
  assert.equal(model.type,'video');
  assert.equal(model.supported,false);
  assert.deepEqual(model.accept,['image','audio','video']);
});
test('图像模型只接受已确认的参考图片',()=>{
  const image=entryFor({id:'gpt-image-1'},'openai-compatible');
  assert.equal(image.supported,true);
  assert.equal(allowedFile(image,{kind:'image'}),true);
  assert.equal(allowedFile(image,{kind:'document'}),false);
});
test('视觉文本模型可引用图片和文档，普通文本模型仅文档',()=>{
  const vision=entryFor({id:'gpt-4o'},'openai-compatible');
  const text=entryFor({id:'deepseek-chat'},'openai-compatible');
  assert.deepEqual(vision.accept,['document','image']);
  assert.deepEqual(text.accept,['document']);
});
