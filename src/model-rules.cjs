const {normalizeBase} = require('./channels.cjs');
const {presets} = require('./catalog.cjs');

const SCHEMA_VERSION = 1;
const MAX_RULE_BYTES = 80 * 1024;
const MAX_RULES = 32;
const RATIOS = new Set(presets.map(preset=>preset.id).filter(id=>id!=='auto'));
const PROTOCOLS = new Set(['openai-images','seedream-json','siliconflow-images']);
const PATH_KINDS = {
  models: /\/models(?:\/list)?$/,
  generate: /\/images\/(?:generations|generate)$/,
  edit: /\/images\/edits$/
};
const SIZE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,15}$/;
const MODEL_ID = /^[\w.-][\w./:-]{0,179}$/;

function fail(message) { throw new Error(message); }
function object(value) { return value && typeof value==='object' && !Array.isArray(value); }
function requireFields(value, fields, message) {
  if (!object(value) || Object.keys(value).some(key=>!fields.includes(key))) fail(message);
}
function apiPath(baseUrl, path, kind) {
  if (typeof path!=='string' || path.length>160 || !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(path) ||
      !PATH_KINDS[kind]?.test(path)) fail('接口路径格式不正确，请填写同一站点的模型列表或图片接口路径');
  const prefix = new URL(baseUrl).pathname.replace(/\/$/, '');
  if (prefix && !path.startsWith(prefix+'/')) fail('接口路径必须在填写的 API 基础地址下');
  return path;
}
function ruleUrl(baseUrl,path,kind) {
  const base=normalizeBase(baseUrl);
  return new URL(base).origin + apiPath(base,path,kind);
}
function checkPixels(size,ratio) {
  if (typeof size!=='string') fail('图片尺寸请填写为 宽x高');
  const match=/^([1-9]\d{1,4})[x×]([1-9]\d{1,4})$/i.exec(size.trim());
  if(!match)fail('图片尺寸格式应为 2816x1584');
  const w=Number(match[1]),h=Number(match[2]);
  if(w<64||h<64||w>8192||h>8192||w*h>33554432)fail('图片尺寸超出可配置范围');
  const [a,b]=ratio.split(':').map(Number);
  if(Math.abs(w/h/(a/b)-1)>.02)fail('像素尺寸和所填画幅不一致');
  return w+'x'+h;
}
function normalizeSizeTable(input) {
  if(!object(input))fail('请填写画幅和分辨率表');
  const tiers=Object.keys(input);
  if(!tiers.length||tiers.length>8)fail('分辨率请设置 1 至 8 档');
  const ratios=Object.keys(input[tiers[0]]||{});
  if(!ratios.length||ratios.some(id=>!RATIOS.has(id)))fail('画幅里包含工作台无法识别的比例');
  const sizes={};
  for(const tier of tiers){
    if(!SIZE_ID.test(tier)||['constructor','prototype'].includes(tier))fail('分辨率标签格式无效');
    const row=input[tier];
    if(!object(row)||Object.keys(row).length!==ratios.length||!ratios.every(ratio=>Object.hasOwn(row,ratio)))
      fail('每一档分辨率都需要填写相同的画幅');
    sizes[tier]=Object.fromEntries(ratios.map(ratio=>[ratio,checkPixels(row[ratio],ratio)]));
  }
  return sizes;
}
function normalizeRule(input) {
  requireFields(input,['baseUrl','modelId','label','protocol','modelsPath','generationPath','editPath',
    'maxRefs','requiredRefs','watermark','allowUnlisted','sizes','defaultResolution'],'规则含有无法识别的字段');
  if(typeof input.baseUrl!=='string'||input.baseUrl.length>250)fail('请输入 API 基础地址');
  const baseUrl=normalizeBase(input.baseUrl);
  if(new URL(baseUrl).protocol!=='https:')fail('在线规则只允许为 HTTPS 地址配置');
  const modelId=String(input.modelId||'').trim();
  if(!MODEL_ID.test(modelId))fail('模型 ID 格式不正确');
  const label=String(input.label||modelId).trim();
  if(!label||label.length>100||/[\u0000-\u001f]/.test(label))fail('模型显示名格式无效');
  const {protocol}=input;
  if(!PROTOCOLS.has(protocol))fail('请选择已支持的图片协议');
  const maxRefs=input.maxRefs??0;
  if(!Number.isInteger(maxRefs)||maxRefs<0||maxRefs>(protocol==='siliconflow-images'?3:10))fail('参考图数量不符合此协议范围');
  for(const key of ['requiredRefs','allowUnlisted','watermark']){
    if(input[key]!==undefined&&typeof input[key]!=='boolean')fail('规则开关参数无效');
  }
  const requiredRefs=input.requiredRefs===true;
  if(requiredRefs&&!maxRefs)fail('必填参考图至少支持一张图');
  if(protocol!=='seedream-json'&&input.watermark!==undefined)fail('这个协议不提供水印参数');
  const generationPath=apiPath(baseUrl,input.generationPath,'generate');
  const modelsPath=input.modelsPath?apiPath(baseUrl,input.modelsPath,'models'):'';
  const editPath=input.editPath?apiPath(baseUrl,input.editPath,'edit'):'';
  if(editPath && protocol!=='openai-images')fail('只有 OpenAI 图片协议需要编辑路径');
  if(protocol==='openai-images' && maxRefs && !editPath)fail('此协议需要单独填写参考图编辑路径');
  const sizes=normalizeSizeTable(input.sizes);
  const defaultResolution=input.defaultResolution||Object.keys(sizes)[0];
  if(!Object.hasOwn(sizes,defaultResolution))fail('默认分辨率必须在尺寸表内');
  return {baseUrl,modelId,label,protocol,modelsPath,generationPath,editPath,maxRefs,requiredRefs,
    ...(protocol==='seedream-json'?{watermark:input.watermark??false}:{}),
    allowUnlisted:input.allowUnlisted===true,sizes,defaultResolution};
}
function normalizeRuleSet(input) {
  requireFields(input,['schemaVersion','rules'],'接口规则格式不正确');
  if(input.schemaVersion!==SCHEMA_VERSION||!Array.isArray(input.rules)||input.rules.length>MAX_RULES)
    fail('接口规则版本不支持或数量过多');
  const models=new Set(),paths=new Map();
  const rules=input.rules.map(raw=>{
    const rule=normalizeRule(raw);
    const key=rule.baseUrl+'\0'+rule.modelId;
    if(models.has(key))fail('同一接口地址下不能有重复的模型 ID');
    models.add(key);
    if(rule.modelsPath){
      if(paths.has(rule.baseUrl)&&paths.get(rule.baseUrl)!==rule.modelsPath)fail('同一接口地址只能设置一个模型列表路径');
      paths.set(rule.baseUrl,rule.modelsPath);
    }
    return rule;
  });
  const config={schemaVersion:SCHEMA_VERSION,rules};
  if(new TextEncoder().encode(JSON.stringify(config)).length>MAX_RULE_BYTES-1024)fail('规则数据过大');
  return config;
}
function validateManifest(value) {
  requireFields(value,['revision','publishedAt','rollbackOf','config'],'接口规则版本格式不正确');
  if(!Number.isSafeInteger(value.revision)||value.revision<0||
     (value.revision>0&&!Number.isFinite(Date.parse(value.publishedAt))))fail('接口规则版本号无效');
  if(value.rollbackOf!=null&&(!Number.isSafeInteger(value.rollbackOf)||value.rollbackOf<0||value.rollbackOf>=value.revision))
    fail('接口规则回退版本无效');
  return {revision:value.revision,publishedAt:value.publishedAt||null,rollbackOf:value.rollbackOf??null,
    config:normalizeRuleSet(value.config)};
}
function emptyManifest() {
  return {revision:0,publishedAt:null,rollbackOf:null,config:{schemaVersion:SCHEMA_VERSION,rules:[]}};
}
function modelsPathFor(config,baseUrl) {
  return config.rules.find(rule=>rule.baseUrl===baseUrl&&rule.modelsPath)?.modelsPath||'';
}
function mergeRules(models,listedIds,config,baseUrl,hasKey) {
  const result=new Map(models.map(model=>[model.id,model]));
  const ids=new Set(listedIds);
  for(const rule of config.rules){
    if(rule.baseUrl!==baseUrl||(!ids.has(rule.modelId)&&!result.has(rule.modelId)&&!(rule.allowUnlisted&&hasKey)))continue;
    const resolutions=Object.keys(rule.sizes);
    result.set(rule.modelId,{id:rule.modelId,label:rule.label,family:'管理端配置',adapter:'managed-image',
      ratios:Object.keys(rule.sizes[resolutions[0]]),resolutions,defaultResolution:rule.defaultResolution,
      refs:rule.maxRefs>0,requiredRefs:rule.requiredRefs,maxRefs:rule.maxRefs,managedRule:rule});
  }
  return [...result.values()];
}
function makeImageRequest(rule,{prompt,size,references=[]}) {
  if(!Object.values(rule.sizes).some(row=>Object.values(row).includes(size)))fail('请求尺寸不在已发布规则内');
  if(references.length>rule.maxRefs || (rule.requiredRefs&&!references.length))fail('参考图数量不符合此模型规则');
  if(rule.protocol==='openai-images'&&references.length){
    return {path:rule.editPath,form:{model:rule.modelId,prompt,size},references};
  }
  const body={model:rule.modelId,prompt};
  if(rule.protocol==='siliconflow-images'){
    body.image_size=size;
    for(const [index,image] of references.entries())body[index?'image'+(index+1):'image']=image;
  }else{
    body.size=size;
    if(rule.protocol==='seedream-json'){
      body.watermark=rule.watermark;
      body.response_format='url';
      if(references.length)body.image=references.length===1?references[0]:references;
    }
  }
  return {path:rule.generationPath,body};
}
function previewRule(rule,ratio,resolution) {
  rule=normalizeRule(rule);
  resolution=resolution||rule.defaultResolution;
  const sizes=Object.hasOwn(rule.sizes,resolution)?rule.sizes[resolution]:null;
  ratio=ratio||Object.keys(sizes||{})[0];
  const size=sizes?.[ratio];
  if(!size)fail('请先为所选画幅和分辨率配置像素尺寸');
  const refs=rule.requiredRefs?['data:image/png;base64,<参考图>']:[];
  const request=makeImageRequest(rule,{prompt:'示例提示词',size,references:refs});
  return {url:ruleUrl(rule.baseUrl,request.path,request.form?'edit':'generate'),
    model:rule.modelId,ratio,resolution,size,encoding:request.form?'multipart/form-data':'application/json',
    body:request.form?{...request.form,image:'<参考图文件>'}:request.body};
}
module.exports={SCHEMA_VERSION,MAX_RULE_BYTES,RATIOS,normalizeRule,normalizeRuleSet,validateManifest,emptyManifest,
  modelsPathFor,ruleUrl,makeImageRequest,previewRule,mergeRules};
