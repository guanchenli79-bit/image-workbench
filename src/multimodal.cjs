const {imageModels,videoModels}=require('./catalog.cjs');
const {providerFor,parseGrsaiPage,grsaiSpec,grsaiVideoSpec,openAiSpec}=require('./providers.cjs');
const {networkFetch}=require('./network.cjs');
const {normalizeBase}=require('./api.cjs');

const TEXT_NAME=/^(gpt-|o[1-9](?:-|$)|claude-|gemini-|deepseek-|qwen|doubao-|glm-|grok-|llama-|mistral-|kimi-|moonshot-|yi-|command-|chatgpt-)/i;
const VIDEO_NAME=/(seedance|sora|veo|kling|hailuo|vidu|wan\d|video|runway|luma|pika|hunyuan-video|minimax-h3|manxue)/i;
const IMAGE_NAME=/(image|dall-e|banana|seedream|flux|recraft|ideogram|midjourney|imagen)/i;
const IMAGE_SUFFIX=/(-image|image-preview|vision|visual)/i;
const IMAGE_TYPES=['image/png','image/jpeg','image/webp'];
const TEXT_TYPES=['text/plain','text/markdown','text/csv','application/json','text/html'];
const knownImages=new Map(imageModels.map(model=>[model.id.toLowerCase(),model]));
const knownVideos=new Map(videoModels.map(model=>[model.id.toLowerCase(),model]));

function listedModalities(row){
  const raw=[row?.type,row?.category,row?.modality,...(Array.isArray(row?.modalities)?row.modalities:[]),...(Array.isArray(row?.input_modalities)?row.input_modalities:[])].filter(Boolean).join(' ').toLowerCase();
  return raw;
}
function textCapabilities(id,row){
  const meta=listedModalities(row);
  const vision=/(vision|image|multimodal|visual)/i.test(meta)||/(gpt-4o|gpt-4\.1|gemini|claude-3|claude-4|qwen-vl)/i.test(id);
  return {accept:['document',...(vision?['image']:[])]};
}
function videoCapabilities(id,row,known){
  const desc=String(row?.desc||row?.description||'');
  const accept=new Set(known?.refs?['image']:[]);
  if(/参考图|图片|首尾帧|image/i.test(desc))accept.add('image');
  if(/音频|audio/i.test(desc))accept.add('audio');
  if(/参考视频|视频参考|video reference|全能参考/i.test(desc)||/seedance[\s.-]*2[.\s-]*5/i.test(id))for(const kind of ['image','audio','video'])accept.add(kind);
  return [...accept];
}
function videoResolutions(row){const desc=String(row?.desc||row?.description||'');const found=[...desc.matchAll(/(?:480p|720p|768p|1080p|2k|4k)/ig)].map(x=>x[0].toUpperCase());return found.length?[...new Set(found)]:['模型默认'];}
function entryFor(row,provider){
  const id=String(typeof row==='string'?row:row?.id||row?.name||'').trim();
  if(!id||id.length>120||/[\s<>]/.test(id))return null;
  const low=id.toLowerCase();const meta=listedModalities(row);
  const knownImage=knownImages.get(low);const knownVideo=knownVideos.get(low);
  const type=knownVideo?'video':knownImage?'image':/video/i.test(meta)?'video':/image/i.test(meta)&&!/text|chat/i.test(meta)?'image':/text|chat|language/i.test(meta)?'text':VIDEO_NAME.test(id)?'video':IMAGE_NAME.test(id)||IMAGE_SUFFIX.test(id)?'image':TEXT_NAME.test(id)?'text':'unknown';
  if(type==='image'){
    const spec=knownImage||openAiSpec(row);
    return spec?{...spec,id,type:'image',accept:spec.refs?['image']:[],supported:provider==='geeknow'||spec.adapter==='legacy-images',reason:provider==='geeknow'||spec.adapter==='legacy-images'?'':'当前端口的生图请求格式需要适配'}:
      {id,label:id,type:'image',family:'待适配',adapter:'unsupported',accept:[],supported:false,reason:'模型已发现；图片请求参数需要适配'};
  }
  if(type==='video')return knownVideo?{...knownVideo,id,type:'video',accept:provider==='geeknow'?['image']:videoCapabilities(id,row,knownVideo),resolutions:provider==='geeknow'?['模型默认']:videoResolutions(row),supported:provider==='geeknow',reason:provider==='geeknow'?'':'当前端口的视频任务协议需要适配'}:
    {id,label:id,type:'video',family:'待适配',adapter:'unsupported',accept:videoCapabilities(id,row),ratios:['16:9'],resolutions:videoResolutions(row),seconds:[5],supported:false,reason:'模型已发现；视频任务协议需要适配'};
  if(type==='text')return {id,label:id,type:'text',family:'对话',adapter:'chat-completions',...textCapabilities(id,row),supported:true,reason:''};
  return {id,label:id,type:'unknown',family:'未分类',adapter:'unsupported',accept:[],supported:false,reason:'接口未提供可识别的模型能力'};
}
function dedupe(rows){const seen=new Set();return rows.filter(row=>{if(!row||seen.has(row.id))return false;seen.add(row.id);return true;});}
function modelsFromStandard(payload,provider){
  const rows=Array.isArray(payload?.data)?payload.data:Array.isArray(payload?.models)?payload.models:null;
  if(!rows)throw new Error('接口未返回标准模型列表');
  return dedupe(rows.slice(0,1000).map(row=>entryFor(row,provider)));
}
function modelsFromGrsai(rows){
  return dedupe(rows.filter(row=>!row?.closeModel).map(row=>{
    if(row.type==='image'){
      const spec=grsaiSpec(row);
      return spec?{...spec,type:'image',accept:spec.refs?['image']:[],supported:true,reason:''}:entryFor(row,'grsai');
    }
    if(row.type==='video'){
      const spec=grsaiVideoSpec(row);
      return spec?{...spec,type:'video',supported:true,reason:''}:entryFor(row,'grsai');
    }
    return entryFor(row,'grsai');
  }));
}
async function syncModels(settings,fetcher=networkFetch){
  const baseUrl=normalizeBase(settings.baseUrl);const provider=providerFor(baseUrl);
  if(!settings.apiKey)throw new Error('请先输入 API Key');
  let standardError;let models=[];let source='';let authVerified=false;
  try{
    const response=await fetcher(baseUrl+'/v1/models',{headers:{Authorization:'Bearer '+settings.apiKey},signal:AbortSignal.timeout(20000)});
    if(response.ok){models=modelsFromStandard(await response.json(),provider);source='/v1/models';authVerified=true;}
    else standardError=`/v1/models 返回 HTTP ${response.status}`;
  }catch(error){standardError=error.message;}
  if(provider==='grsai'){
    try{
      const response=await fetcher('https://grsai.ai/dashboard/models',{signal:AbortSignal.timeout(20000)});
      if(response.ok){const fromPage=modelsFromGrsai(parseGrsaiPage(await response.text()));models=dedupe([...fromPage,...models]);source=source?source+' + Grsai 模型页':'Grsai 模型页';}
    }catch{}
  }
  if(!models.length)throw new Error(`无法获取可识别的模型：${standardError||'接口模型页不可用'}。请检查地址与 Key；非标准端口需要适配。`);
  return {provider,source,models,authVerified};
}
function allowedFile(model,file){return Boolean(model?.accept?.includes(file.kind));}
module.exports={entryFor,modelsFromStandard,modelsFromGrsai,syncModels,allowedFile,TEXT_TYPES,IMAGE_TYPES};
