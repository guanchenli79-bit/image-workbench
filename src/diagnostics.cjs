const SCENARIOS = [
  {id:'text',label:'文本对话',type:'text',reference:null},
  {id:'text-image',label:'文生图',type:'image',reference:null},
  {id:'image-image',label:'图生图',type:'image',reference:'image'},
  {id:'text-video',label:'文生视频',type:'video',reference:null},
  {id:'image-video',label:'图生视频',type:'video',reference:'image'},
  {id:'audio-video',label:'音频参考生视频',type:'video',reference:'audio'},
  {id:'reference-video',label:'参考视频生视频',type:'video',reference:'video'}
];

function cleanApiKey(value){
  const raw=String(value||'').trim();
  const token=raw.replace(/^Bearer\s+/i,'').trim();
  if(!token)throw new Error('请填写当前接口的 API Key');
  if(!/^[\x21-\x7e]+$/.test(token))throw new Error('API Key 含中文、空格或不可用字符；请只粘贴控制台生成的原始密钥');
  return {token,removedBearer:token!==raw};
}

function planScenarios(models){
  const supported=(models||[]).filter(model=>model.supported);
  return SCENARIOS.map(scenario=>{
    const candidate=supported.find(model=>model.type===scenario.type&&
      (scenario.reference?model.accept?.includes(scenario.reference):!model.requiredRefs));
    return {...scenario,modelId:candidate?.id||null,modelName:candidate?.label||candidate?.id||'',
      route:candidate?routeFor(candidate,scenario):'',
      status:candidate?'ready':'unsupported'};
  });
}

function routeFor(model,scenario){
  if(model.type==='text')return 'POST /v1/chat/completions';
  if(model.adapter==='grsai-image'||model.adapter==='grsai-video')return 'POST /v1/api/generate';
  if(model.adapter==='gemini')return `POST /v1beta/models/${model.id}:generateContent`;
  if(model.adapter==='midjourney')return 'POST /mj/submit/imagine';
  if(model.adapter==='task-image'||model.type==='video')return 'POST /v1/videos';
  if(model.adapter==='legacy-images'&&scenario.reference)return 'POST /v1/images/edits';
  if(['gpt-image-2','gpt-image-2-pro','gpt-image-2.5-flare','gpt-image-2.5-sunburst','gpt-image-2-vip'].includes(model.id)&&scenario.reference)return 'POST /v1/images/generations/async';
  return 'POST /v1/images/generations';
}

module.exports={SCENARIOS,cleanApiKey,planScenarios,routeFor};
