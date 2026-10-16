const path = require('node:path');
const { Blob } = require('node:buffer');
const { networkFetch } = require('./network.cjs');
const URL_REFERENCE_IMAGE_MODELS = new Set(['gpt-image-2','gpt-image-2-pro','gpt-image-2.5-flare','gpt-image-2.5-sunburst','gpt-image-2-vip']);

function normalizeBase(value) {
  const raw = String(value || 'https://www.geeknow.top').trim().replace(/\/+$/, '');
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('接口地址必须以 https:// 开头');
  if (url.protocol === 'http:' && !['localhost','127.0.0.1','::1'].includes(url.hostname)) throw new Error('为保护 API Key，远程接口地址必须使用 HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new Error('接口地址请只填写基础 URL');
  return url.href.replace(/\/+$/, '');
}

function errorText(data, status) {
  const raw = String(data?.error?.message || data?.message || data?.description || `API 请求失败（HTTP ${status}）`);
  if (/rejected by the safety system/i.test(raw)) {
    const requestId = /request ID\s+([\da-f-]{20,})/i.exec(raw)?.[1];
    return `上游安全系统拒绝了这次生成。请检查并调整提示词或参考图；如果认为误判，请联系 Geeknow 客服${requestId ? `，附上请求 ID：${requestId}` : ''}。`;
  }
  return raw;
}

async function requestJson(settings, route, options = {}) {
  const base = normalizeBase(settings.baseUrl);
  if (!settings.apiKey) throw new Error('请先设置 API Key');
  const url = base + route;
  const { allowTaskError = false, ...requestOptions } = options;
  const response = await networkFetch(url, {
    ...requestOptions,
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      ...(!(requestOptions.body instanceof FormData) ? {'Content-Type':'application/json'} : {}),
      ...requestOptions.headers
    },
    signal: requestOptions.signal || AbortSignal.timeout(180000)
  });
  const body = await response.text();
  let data;
  try { data = JSON.parse(body); } catch { data = { message: body.slice(0,300) }; }
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { data = { message: data.slice(0,300) }; }
  }
  if (!response.ok || data?.success === false || (data?.error && !allowTaskError)) throw new Error(errorText(data, response.status));
  return data;
}

function imageItems(data) {
  if (Array.isArray(data?.data)) return data.data.map(x => ({ url:x.url, b64:x.b64_json, mime:'image/png' })).filter(x => x.url || x.b64);
  const parts = data?.candidates?.flatMap(x => x?.content?.parts || []) || [];
  return parts.map(x => ({ url: /^https?:\/\//.test(x?.inlineData?.data || '') ? x.inlineData.data : null,
    b64: /^https?:\/\//.test(x?.inlineData?.data || '') ? null : x?.inlineData?.data,
    mime: x?.inlineData?.mimeType || 'image/png' })).filter(x => x.url || x.b64);
}

function dataUri(ref) { return `data:${ref.mime};base64,${ref.buffer.toString('base64')}`; }
const MIDJOURNEY_REQUEST_FAILED = 'Midjourney 上游处理这次生成请求失败（do_request_failed）。请尝试精简提示词、减少参考图；若持续出现，请将发生时间和错误码提交给 Geeknow 客服。';

async function uploadMidjourneyReferences(settings, references) {
  const urls = [];
  for (let index = 0; index < references.length; index++) {
    let data;
    try {
      data = await requestJson(settings, '/mj/submit/upload-discord-images', {
        method:'POST', body:JSON.stringify({mode:'FAST',base64Array:[dataUri(references[index])]})
      });
    } catch (error) {
      throw new Error(`Midjourney 第 ${index + 1} 张参考图上传失败：${error.message}`, {cause:error});
    }
    const result = data?.result;
    const url = Array.isArray(result) ? result[0] : null;
    if (![1,21,22].includes(Number(data?.code)) || typeof url !== 'string' || !/^https:\/\//i.test(url)) {
      throw new Error(`Midjourney 第 ${index + 1} 张参考图上传失败：${errorText(data,200)}`);
    }
    urls.push(url);
  }
  return urls;
}

async function uploadReference(settings, ref) {
  const sign = await requestJson(settings, '/api/upload/presign', {
    method:'POST', body:JSON.stringify({file_name:path.basename(ref.name), content_type:ref.mime, expires_in:900})
  });
  const target = sign?.data;
  if (!target?.upload_url || !target?.public_url) throw new Error('该 API 通道未返回素材上传地址，请检查上传服务是否可用');
  const uploadUrl = new URL(target.upload_url);
  const isSecureUrl = url => url.protocol === 'https:' || url.protocol === 'http:' && ['localhost','127.0.0.1','::1'].includes(url.hostname);
  if (!isSecureUrl(uploadUrl)) throw new Error('素材上传地址未使用 HTTPS');
  const response = await networkFetch(uploadUrl, {method:'PUT', headers:{'Content-Type':ref.mime}, body:ref.buffer, signal:AbortSignal.timeout(120000)});
  if (!response.ok) throw new Error(`参考图上传失败（HTTP ${response.status}）`);
  const publicUrl = new URL(target.public_url);
  if (!isSecureUrl(publicUrl)) throw new Error('参考图公开地址未使用 HTTPS');
  return publicUrl.href;
}

async function uploadReferences(settings, references, modelName) {
  return Promise.all(references.map(async(ref,index)=>{
    try { return await uploadReference(settings,ref); }
    catch(error) { throw new Error(`${modelName} 第 ${index+1} 张参考图上传失败：${error.message}`,{cause:error}); }
  }));
}

async function generateImage(settings, input, model, sizing, references) {
  const { prompt } = input;
  if (model.adapter === 'gemini') {
    const parts = [{text:prompt}, ...references.map(ref => ({inlineData:{mimeType:ref.mime,data:ref.buffer.toString('base64')}}))];
    const data = await requestJson(settings, `/v1beta/models/${encodeURIComponent(model.id)}:generateContent`, {
      method:'POST', body:JSON.stringify({contents:[{role:'user',parts}],generationConfig:{responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:sizing.ratio,imageSize:model.id==='gemini-3-pro-image-preview'?'2K':'1K'}}})
    });
    const items = imageItems(data);
    if (!items.length) throw new Error('接口没有返回图片，请检查模型输出或通道状态');
    return {kind:'complete',items};
  }
  if (model.adapter === 'midjourney') {
    const imageUrls = await uploadMidjourneyReferences(settings, references);
    const text = /--ar\s+\d+:\d+/.test(prompt) ? prompt : `${prompt} --ar ${sizing.ratio}`;
    const submittedPrompt = [...imageUrls,text].join(' ');
    let data;
    try {
      data = await requestJson(settings, '/mj/submit/imagine', {method:'POST',body:JSON.stringify({mode:'FAST',prompt:submittedPrompt,base64Array:[]})});
    } catch (error) {
      if (/do_request_failed/i.test(error.message)) throw new Error(MIDJOURNEY_REQUEST_FAILED, {cause:error});
      throw error;
    }
    if (![1,21,22].includes(Number(data.code)) || !data.result) {
      const detail = errorText(data,200);
      if (/do_request_failed/i.test(detail)) throw new Error(MIDJOURNEY_REQUEST_FAILED);
      throw new Error(`Midjourney 提交失败（code ${data.code ?? '未知'}）：${detail}`);
    }
    return {kind:'task',taskId:String(data.result),taskAdapter:'midjourney'};
  }
  if (model.adapter === 'task-image') {
    const urls = await uploadReferences(settings,references,model.label || model.id);
    const [width,height] = sizing.size.split('x').map(Number);
    const body = {model:model.id,prompt,metadata:{output_image_count:1,output_config:{width,height,aspect_ratio:sizing.ratio}}};
    if (urls.length === 1) body.image = urls[0];
    if (urls.length > 1) body.images = urls;
    const data = await requestJson(settings, '/v1/videos', {method:'POST',body:JSON.stringify(body)});
    const taskId = data.task_id || data.id;
    if (!taskId) throw new Error('接口未返回任务 ID');
    return {kind:'task',taskId:String(taskId),taskAdapter:'video'};
  }
  if (model.adapter === 'legacy-images' && references.length) {
    const form = new FormData();
    form.append('model',model.id); form.append('prompt',prompt); form.append('size',sizing.size);
    for (const ref of references) form.append('image',new Blob([ref.buffer],{type:ref.mime}),ref.name);
    const data = await requestJson(settings,'/v1/images/edits',{method:'POST',body:form});
    const items = imageItems(data);
    if (!items.length) throw new Error('接口没有返回图片');
    return {kind:'complete',items};
  }
  if (URL_REFERENCE_IMAGE_MODELS.has(model.id) && references.length) {
    const urls = await uploadReferences(settings,references,model.label || model.id);
    const data = await requestJson(settings,'/v1/images/generations/async',{
      method:'POST',body:JSON.stringify({model:model.id,prompt,n:1,size:sizing.size,image:urls})
    });
    const items = imageItems(data);
    if (items.length) return {kind:'complete',items};
    const taskId = data.id || data.task_id || data.taskId;
    if (!taskId) throw new Error('图像接口未返回任务 ID 或图片');
    return {kind:'task',taskId:String(taskId),taskAdapter:'image-async'};
  }
  const body = {model:model.id,prompt,n:1,size:sizing.size};
  if (references.length) body.image = references.map(ref=>ref.buffer.toString('base64'));
  if (model.adapter === 'legacy-images') body.response_format = 'url';
  const data = await requestJson(settings,'/v1/images/generations',{method:'POST',body:JSON.stringify(body)});
  const items = imageItems(data);
  if (!items.length) throw new Error('接口没有返回图片，请检查模型输出或通道状态');
  return {kind:'complete',items};
}

async function generateVideo(settings, input, model, sizing, references) {
  const urls = await Promise.all(references.map(ref => uploadReference(settings,ref)));
  const body = {model:model.id,prompt:input.prompt};
  const sec = Number(input.seconds) || model.seconds[0];
  if (model.id === 'mini-2.0') { body.duration=sec; body.ratio=sizing.ratio; body.resolution='480p'; if(urls.length)body.images=urls; }
  else if (model.id === 'manxue-2.5') { body.seconds=30; body.ratio=sizing.ratio; body.images=urls; }
  else if (model.id === 'MiniMax-H3') { body.duration=sec; body.resolution='768P'; body.ratio=sizing.ratio; body.content=[{type:'text',text:input.prompt},...urls.map(url=>({type:'image_url',image_url:{url},role:'reference_image'}))]; }
  else if (model.id.startsWith('grok-imagine')) { body.seconds=sec; body.aspect_ratio=sizing.ratio; body.resolution='720P'; if(urls.length)body.images=urls; }
  else if (model.id.startsWith('doubao-seedance-2')) { body.duration=sec; body.aspect_ratio=sizing.ratio; if(urls.length===1)body.first_image=urls[0]; if(urls.length>1)body.reference_image_urls=urls; }
  else if (model.id.startsWith('wan3.0')) { body.seconds=sec; body.aspect_ratio=sizing.ratio; body.size='720P'; if(urls.length===1)body.image=urls[0]; if(urls.length>1)body.images=urls; }
  else if (model.id.startsWith('omni')) { body.seconds=sec; body.aspect_ratio=sizing.ratio; if(urls.length===1)body.first_image_url=urls[0]; if(urls.length>1)body.images=urls; }
  else if (model.id === 'manxue-2.0') { body.seconds=sec; body.resolution='720P'; body.content=urls.map((url,i)=>({type:'image_url',image_url:{url},role:i?'reference_image':'first_frame'})); }
  else { body.seconds=String(sec); body.size=sizing.size; if(urls.length===1)body.input_reference=urls[0]; if(urls.length>1)body.input_reference=urls; }
  const data = await requestJson(settings,'/v1/videos',{method:'POST',body:JSON.stringify(body)});
  const taskId = data.task_id || data.id;
  if (!taskId) throw new Error('接口未返回视频任务 ID');
  return {kind:'task',taskId:String(taskId),taskAdapter:'video'};
}

async function queryTask(settings, adapter, taskId, type) {
  if (adapter === 'midjourney') {
    const data = await requestJson(settings,`/mj/task/${encodeURIComponent(taskId)}/fetch`);
    const status = String(data.status || '').toUpperCase();
    if (status === 'FAILURE' || status === 'CANCEL') return {status:'failed',error:data.failReason || data.description || 'Midjourney 任务失败'};
    if (status !== 'SUCCESS') return {status:'pending',progress:parseInt(data.progress,10)||0};
    const urls = [data.imageUrl,...(data.imageUrls||[]).map(x=>typeof x==='string'?x:x.url)].filter(Boolean);
    if (!urls.length) urls.push(normalizeBase(settings.baseUrl)+`/mj/image/${encodeURIComponent(taskId)}`);
    return {status:'complete',items:urls.map(url=>({url,mime:'image/png'}))};
  }
  if (adapter === 'image-async') {
    const data = await requestJson(settings,`/v1/images/generations/async/${encodeURIComponent(taskId)}`,{allowTaskError:true});
    const status = String(data.status || '').toLowerCase();
    if (['failed','failure','cancelled','canceled'].includes(status)) return {status:'failed',error:data.error?.message || data.message || '图像生成任务失败'};
    if (data.error) throw new Error(errorText(data,200));
    const items = imageItems(data);
    if (items.length) return {status:'complete',items};
    if (['completed','succeeded','success','finish','finished'].includes(status)) throw new Error('图像任务已完成，但接口没有返回图片');
    return {status:'pending',progress:Math.min(99,Math.max(0,parseInt(data.progress,10)||0))};
  }
  const data = await requestJson(settings,`/v1/videos/${encodeURIComponent(taskId)}`);
  const status = String(data.status || '').toLowerCase();
  if (['failed','failure','cancelled','canceled'].includes(status)) return {status:'failed',error:data.error?.message || data.message || '任务失败'};
  if (!['completed','succeeded','success','finish','finished'].includes(status)) return {status:'pending',progress:Number(data.progress)||0};
  const urls = [data.video_url,...(data.output?.file_infos||[]).map(x=>x.file_url),...(data.data||[]).map(x=>x.url)].filter(Boolean);
  if (!urls.length && type === 'video') urls.push(normalizeBase(settings.baseUrl)+`/v1/videos/${encodeURIComponent(taskId)}/content`);
  if (!urls.length) throw new Error('任务完成，但没有找到生成文件地址');
  return {status:'complete',items:urls.map(url=>({url,mime:type==='video'?'video/mp4':'image/png'}))};
}

module.exports = { normalizeBase, requestJson, generateImage, generateVideo, queryTask };
