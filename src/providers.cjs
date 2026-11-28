const {imageModels:geeknowCatalog} = require('./catalog.cjs');
const {networkFetch} = require('./network.cjs');
const {providerFor,normalizeBase,imageApiBases} = require('./channels.cjs');
const {seedreamSpec,modelGoSeedreamSpec} = require('./seedream.cjs');
const {siliconFlowSpec} = require('./siliconflow.cjs');
const {ruleUrl} = require('./model-rules.cjs');

const GRS_RATIOS=['1:1','16:9','9:16','4:3','3:4','3:2','2:3','5:4','4:5','21:9'];
const GRS_GPT_RATIOS=[...GRS_RATIOS,'9:21','1:2','2:1'];

function parseGrsaiPage(html) {
  const chunks=[...String(html).matchAll(/self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)<\/script>/g)]
    .map(match=>{try{return JSON.parse(match[1]);}catch{return '';}});
  const chunk=chunks.find(value=>value.includes('"models":['));
  if(!chunk)throw new Error('渠道模型页未返回可识别的数据');
  const marker='"models":[';
  const start=chunk.indexOf(marker)+marker.length-1;
  let depth=0,inString=false,escaped=false,end=-1;
  for(let i=start;i<chunk.length;i++){
    const c=chunk[i];
    if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;}
    else if(c==='"')inString=true;
    else if(c==='[')depth++;
    else if(c===']'&&!--depth){end=i+1;break;}
  }
  if(end<0)throw new Error('渠道模型数据不完整');
  const models=JSON.parse(chunk.slice(start,end));
  if(!Array.isArray(models)||models.length>1000)throw new Error('渠道模型数据格式不正确');
  return models;
}

function grsaiSpec(entry) {
  if(entry?.type!=='image'||entry.closeModel)return null;
  const id=String(entry.name||'').trim();
  if(!/^[\w.-]{2,90}$/.test(id))return null;
  const description=String(entry.desc||'').slice(0,250);
  if(/^gpt-image-2(?:\.5)?(?:-(?:vip|flare|sunburst))?$/.test(id)){
    const extended=/-vip|-flare|-sunburst/.test(id);
    const resolutions=extended?['1K','2K','4K']:['1K'];
    return {id,label:id,family:'GPT Image',adapter:'grsai-image',grsaiFamily:'gpt',refs:true,
      ratios:GRS_GPT_RATIOS,resolutions,quality:id.endsWith('-vip')?'medium':id.endsWith('-flare')||id.endsWith('-sunburst')?'medium':'auto',description};
  }
  if(/^nano-banana(?:-[\w.-]+)?$/.test(id)){
    const resolutions=['1K','2K','4K'].filter(value=>description.toUpperCase().includes(value));
    if(!resolutions.length)resolutions.push(/4k/i.test(id)?'4K':/2k/i.test(id)?'2K':'1K');
    return {id,label:id,family:'Nano Banana',adapter:'grsai-image',grsaiFamily:'nano',refs:true,
      ratios:GRS_RATIOS,resolutions,description};
  }
  return null;
}

const validModelId = id => typeof id === 'string' && /^[\w.-][\w./:-]{0,179}$/.test(id);
const compatibleRatios = ['1:1','4:3','3:4','3:2','2:3','16:9','9:16','21:9','9:21','2:1','1:2','5:4','4:5'];

function modelIdOf(entry) {
  return String(typeof entry === 'string' ? entry : entry?.id || entry?.name || '').trim();
}

function declaresImageOutput(entry) {
  const outputs = entry?.modalities?.output_modalities || entry?.architecture?.output_modalities || entry?.output_modalities;
  return Array.isArray(outputs) && outputs.includes('image') ||
    ['image','image_generation','text-to-image'].includes(entry?.type) ||
    entry?.domain === 'ImageGeneration' ||
    Array.isArray(entry?.task_type) && entry.task_type.includes('TextToImage') ||
    entry?.capabilities?.image_generation === true;
}

function advertisedSizes(entry) {
  const raw = entry?.supported_sizes || entry?.capabilities?.image_sizes;
  const sizes = {};
  if (!Array.isArray(raw)) return sizes;
  for (const size of raw) {
    if (typeof size !== 'string' || !/^\d{2,5}x\d{2,5}$/.test(size)) continue;
    const [w,h] = size.split('x').map(Number);
    const ratio = compatibleRatios.find(option => {
      const [a,b] = option.split(':').map(Number);
      return Math.abs(w/h/(a/b)-1)<.015;
    });
    if (ratio && !sizes[ratio]) sizes[ratio] = size;
  }
  return sizes;
}

function openAiSpec(entry) {
  const id = modelIdOf(entry);
  if (!validModelId(id)) return null;
  const apiName = id.split('/').at(-1);
  const allowedApis = entry?.supported_apis || entry?.supported_endpoints;
  if (Array.isArray(allowedApis) && !allowedApis.some(api =>
    typeof api === 'string' && /(^|\/)images\/generations$|^image_generation$/i.test(api))) return null;
  if (/^gpt-image-1(?:[.-][\w.-]+)?$|^dall-e-[23]$/.test(apiName)) {
    return {id,label:id,family:'OpenAI 兼容图像',adapter:'legacy-images',refs:apiName!=='dall-e-3',
      ratios:apiName==='dall-e-2'?['1:1']:['1:1','3:2','2:3'],resolutions:['default']};
  }
  if (!declaresImageOutput(entry)) return null;
  const imageSizes = advertisedSizes(entry);
  const ratios = Object.keys(imageSizes);
  const refs = Array.isArray(allowedApis) && allowedApis.some(api =>
    typeof api === 'string' && /(^|\/)images\/edits$/i.test(api));
  return {id,label:id,family:'兼容图像',adapter:'standard-image',refs,
    defaultSizing:!ratios.length,ratios:ratios.length?ratios:['1:1'],resolutions:['default'],imageSizes};
}

function imageListFromModels(payload,provider,imageApiBase) {
  const rows = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : null;
  if (!rows) throw new Error('接口未返回标准模型列表');
  const models = new Map();
  const unsupportedModels = new Set();
  for (const row of rows) {
    const id = modelIdOf(row);
    if (!validModelId(id)) continue;
    let model;
    let isImage;
    if (provider === 'ark') {
      isImage = declaresImageOutput(row) ||
        Array.isArray(row?.task_type) && row.task_type.includes('ImageToImage') ||
        (!row?.domain && /^doubao-seedream-/.test(id));
      if (!isImage || (row.status && !['Published','Retiring'].includes(row.status))) continue;
      model = seedreamSpec(row);
    } else if (provider === 'siliconflow') {
      // The official models endpoint was explicitly filtered with type=image.
      isImage = true;
      model = siliconFlowSpec(id);
    } else {
      model = (provider==='geeknow' && geeknowCatalog.find(item=>item.id===id)) ||
        modelGoSeedreamSpec(id,imageApiBase) || openAiSpec(row);
      isImage = declaresImageOutput(row) || /image|dall-e|banana|seedream|flux|recraft|ideogram/i.test(id);
    }
    if (model) models.set(id,model);
    else if (isImage) unsupportedModels.add(id);
  }
  for (const id of models.keys()) unsupportedModels.delete(id);
  return {models:[...models.values()],unsupportedCount:unsupportedModels.size,unsupportedModels:[...unsupportedModels]};
}

async function discoverModelList(settings,provider,fetcher) {
  if(settings.modelsPath){
    const url=ruleUrl(settings.baseUrl,settings.modelsPath,'models')+(provider==='siliconflow'?'?type=image':'');
    const result=await fetchModelList(url,settings.apiKey,fetcher);
    if(!result)throw new Error('管理端设置的模型列表路径没有返回可识别的列表');
    return {payload:result,apiBase:undefined};
  }
  const compatible = provider === 'openai-compatible';
  const bases = compatible ? imageApiBases(settings.baseUrl) :
    [provider==='ark' ? settings.baseUrl : settings.baseUrl+'/v1'];
  const suffix = provider==='siliconflow' ? '/models?type=image' : '/models';
  for (const [index,apiBase] of bases.entries()) {
    const url = apiBase + suffix;
    const canTryNext = index < bases.length-1;
    const payload=await fetchModelList(url,settings.apiKey,fetcher);
    if (!payload && canTryNext) continue;
    if (!payload) throw new Error('此地址未提供可识别的模型列表，请检查 API 接入地址或管理端规则');
    return {payload,apiBase};
  }
  throw new Error('模型列表不可用');
}

async function fetchModelList(url,key,fetcher){
  const response=await fetcher(url,{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(12000),redirect:'error'});
  if(response.status===401||response.status===403)throw new Error('模型列表拒绝了此 API Key，请核对接口地址、Key 和项目权限');
  if([404,405,501].includes(response.status))return null;
  if(!response.ok)throw new Error('读取模型列表失败（HTTP '+response.status+'）');
  const payload=await response.json().catch(()=>null);
  return Array.isArray(payload?.data)||Array.isArray(payload?.models)?payload:null;
}
function catalogIds(payload){
  const rows=payload?.data||payload?.models||[];
  return [...new Set(rows.map(modelIdOf).filter(validModelId))].slice(0,3000);
}
async function syncImageModels(settings,fetcher=networkFetch) {
  const baseUrl = normalizeBase(settings.baseUrl);
  const provider = providerFor(baseUrl);
  if (provider==='grsai'&&!settings.modelsPath) {
    const response=await fetcher('https://grsai.ai/dashboard/models',{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error('渠道模型页暂不可用（HTTP '+response.status+'）');
    const rows=parseGrsaiPage(await response.text()).filter(row=>row?.type==='image'&&!row.closeModel);
    const models=rows.map(grsaiSpec).filter(Boolean);
    const unsupportedModels=[...new Set(rows.filter(row=>!grsaiSpec(row)).map(row=>row.name).filter(validModelId))];
    return {provider,models,catalogModelIds:catalogIds({data:rows}),unsupportedCount:unsupportedModels.length,
      unsupportedModels,source:'官方模型列表',authVerified:false};
  }
  if(!settings.apiKey)throw new Error('请先填写当前端口的 API Key，再同步模型');
  const {payload,apiBase} = await discoverModelList({...settings,baseUrl},provider,fetcher);
  const defaultBase=apiBase||imageApiBases(baseUrl)[0];
  return {provider,...imageListFromModels(payload,provider,defaultBase),source:'接口模型列表',authVerified:true,
    catalogModelIds:catalogIds(payload),imageApiBase:provider==='openai-compatible'?defaultBase:undefined};
}

module.exports={providerFor,parseGrsaiPage,grsaiSpec,openAiSpec,imageListFromModels,syncImageModels};
