const test=require('node:test');
const assert=require('node:assert/strict');
const {grsaiVideoSpec}=require('../src/providers.cjs');
const {modelsFromGrsai,allowedFile}=require('../src/multimodal.cjs');
const {resolveSize}=require('../src/sizing.cjs');

test('Grsai 仅对已确认协议的视频模型开放生成',()=>{
  const found=modelsFromGrsai([
    {name:'minimax-h3',type:'video',desc:'480p/768p/1080p，参考图、音频'},
    {name:'agnes-video-2.5',type:'video',desc:'720p/1080p/2k'},
    {name:'unknown-video',type:'video'}
  ]);
  assert.equal(found[0].supported,true);
  assert.equal(found[0].adapter,'grsai-video');
  assert.equal(found[1].supported,true);
  assert.equal(found[2].supported,false);
  assert.equal(allowedFile(found[0],{kind:'audio'}),true);
  assert.equal(allowedFile(found[0],{kind:'video'}),false);
});

test('Grsai 视频尺寸限制与画幅匹配',()=>{
  const h3=grsaiVideoSpec({name:'minimax-h3',type:'video'});
  const size=resolveSize(h3,'9:16','',null,'480p');
  assert.equal(size.ratio,'9:16');
  assert.equal(size.resolution,'480p');
  assert.throws(()=>resolveSize(h3,'16:9','',null,'4K'),/不支持/);
});
