const {imageModels:geeknowCatalog} = require('./catalog.cjs');
const {networkFetch} = require('./network.cjs');

const GRS_RATIOS=['1:1','16:9','9:16','4:3','3:4','3:2','2:3','5:4','4:5','21:9'];
const GRS_GPT_RATIOS=[...GRS_RATIOS,'9:21','1:2','2:1'];

function providerFor(baseUrl) {
  const host=new URL(baseUrl).hostname.toLowerCase();
  if(host==='grsaiapi.com'||host==='grsai.dakka.com.cn')return 'grsai';
  if(host==='www.geeknow.top'||host==='geeknow.top')return 'geeknow';
  return 'openai-compatible';
}

function parseGrsaiPage(html) {
  const chunks=[...String(html).matchAll(/self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)<\/script>/g)]
    .map(match=>{try{return JSON.parse(match[1]);}catch{return '';}});
  const chunk=chunks.find(value=>value.includes('"models":['));
  if(!chunk)throw new Error('Grsai ??????????????');
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
  if(end<0)throw new Error('Grsai ???????');
  const models=JSON.parse(chunk.slice(start,end));
  if(!Array.isArray(models)||models.length>1000)throw new Error('Grsai ?????????');
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
    return {id,label:id,family:'Grsai ? GPT Image',adapter:'grsai-image',grsaiFamily:'gpt',refs:true,
      ratios:GRS_GPT_RATIOS,resolutions,quality:id.endsWith('-vip')?'medium':id.endsWith('-flare')||id.endsWith('-sunburst')?'medium':'auto',description};
  }
  if(/^nano-banana-[\w.-]+$/.test(id)){
    const resolutions=['1K','2K','4K'].filter(value=>description.toUpperCase().includes(value));
    if(!resolutions.length)resolutions.push(/4k/i.test(id)?'4K':/2k/i.test(id)?'2K':'1K');
    return {id,label:id,family:'Grsai ? Nano Banana',adapter:'grsai-image',grsaiFamily:'nano',refs:true,
      ratios:GRS_RATIOS,resolutions,description};
  }
  return null;
}

function openAiSpec(entry) {
  const id=String(typeof entry==='string'?entry:entry?.id||entry?.name||'').trim();
  if(!/^[\w.-]{2,90}$/.test(id))return null;
  if(!/^gpt-image-1(?:[.-][\w.-]+)?$|^dall-e-[23]$/.test(id))return null;
  return {id,label:id,family:'OpenAI ????',adapter:'legacy-images',refs:id!=='dall-e-3',
    ratios:id==='dall-e-2'?['1:1']:['1:1','3:2','2:3'],resolutions:['default']};
}

function imageListFromModels(payload,provider) {
  const rows=Array.isArray(payload?.data)?payload.data:Array.isArray(payload?.models)?payload.models:null;
  if(!rows)throw new Error('???????????');
  const found=[],seen=new Set();let unsupportedCount=0;
  for(const row of rows){
    const id=String(row?.id||row?.name||'');
    const known=provider==='geeknow'?geeknowCatalog.find(model=>model.id===id):null;
    const model=known||openAiSpec(row);
    if(model&&!seen.has(id)){found.push({...model});seen.add(id);}
    else if(/image|dall-e|banana|seedream|flux|recraft|ideogram/i.test(id))unsupportedCount++;
  }
  if(!found.length)throw new Error('???????????????????????????????');
  return {models:found,unsupportedCount};
}

async function syncImageModels(settings,fetcher=networkFetch) {
  const provider=providerFor(settings.baseUrl);
  if(provider==='grsai'){
    const response=await fetcher('https://grsai.ai/dashboard/models',{signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw new Error('Grsai ????????HTTP '+response.status+'?');
    const rows=parseGrsaiPage(await response.text()).filter(row=>row?.type==='image'&&!row.closeModel);
    const models=rows.map(grsaiSpec).filter(Boolean);
    if(!models.length)throw new Error('Grsai ????????????');
    return {provider,models,unsupportedCount:rows.length-models.length,source:'Grsai ?????'};
  }
  if(!settings.apiKey)throw new Error('????????? API Key??????');
  const response=await fetcher(settings.baseUrl+'/v1/models',{
    headers:{Authorization:'Bearer '+settings.apiKey},signal:AbortSignal.timeout(20000)
  });
  if(!response.ok){
    if(response.status===401||response.status===403)throw new Error('??????? API Key???? Key ????????');
    if(response.status===404)throw new Error('??????? /v1/models ?????????');
    throw new Error('?????????HTTP '+response.status+'?');
  }
  const parsed=await response.json();
  return {provider,...imageListFromModels(parsed,provider),source:'/v1/models'};
}

module.exports={providerFor,parseGrsaiPage,grsaiSpec,openAiSpec,imageListFromModels,syncImageModels};
