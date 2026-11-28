const CHANNELS = [
  {id:'one', label:'渠道一', baseUrl:'https://grsaiapi.com', provider:'grsai'},
  {id:'two', label:'渠道二', baseUrl:'https://ark.cn-beijing.volces.com/api/v3', provider:'ark'}
];
const ARK_HOST = 'ark.cn-beijing.volces.com';
const PROVIDER_HOSTS = new Map([
  ['grsaiapi.com','grsai'], ['grsai.dakka.com.cn','grsai'],
  [ARK_HOST,'ark'],
  ['geeknow.top','geeknow'], ['www.geeknow.top','geeknow'],
  ['api.siliconflow.cn','siliconflow'], ['api.siliconflow.com','siliconflow']
]);
const VERSIONED = /\/v\d+(?:[a-z][a-z\d.-]*)?$/i;
const API_RESOURCE = /\/(?:models|images\/(?:generations|edits)|chat\/completions)$/i;

function providerFor(baseUrl) {
  return PROVIDER_HOSTS.get(new URL(baseUrl).hostname.toLowerCase()) || 'openai-compatible';
}

function normalizeBase(value) {
  const raw = String(value ?? 'https://www.geeknow.top').trim();
  let url;
  try { url = new URL(raw); }
  catch { throw new Error('请输入完整的接口地址，例如 https://example.com/v1'); }
  if (!['https:','http:'].includes(url.protocol)) throw new Error('接口地址必须使用 HTTPS');
  if (url.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname))
    throw new Error('为保护 API Key，远程接口地址必须使用 HTTPS');
  if (url.username || url.password || url.search || url.hash) throw new Error('接口地址请勿包含账号、密码、查询参数或片段');

  const provider = providerFor(url);
  let pathname = url.pathname.replace(/\/+$/, '');
  if (provider === 'grsai') pathname = pathname.replace(/\/v1\/api\/(?:generate|result)$/i, '/v1');
  pathname = pathname.replace(API_RESOURCE, '');
  if (provider === 'ark') {
    if (!pathname) pathname = '/api/v3';
    if (pathname !== '/api/v3')
      throw new Error('方舟按量生图请使用 /api/v3；其他套餐路径需要单独适配');
  } else {
    // Keep the same profile key as previous releases for standard /v1 addresses.
    pathname = pathname.replace(/\/v1$/i, '');
    if (['grsai','geeknow','siliconflow'].includes(provider) && pathname)
      throw new Error('请填写该服务的官方 API 基础地址或生图接口地址');
  }
  return url.origin + pathname;
}

function imageApiBases(baseUrl) {
  if (VERSIONED.test(new URL(baseUrl).pathname)) return [baseUrl];
  return [baseUrl + '/v1', baseUrl];
}

function imageApiUrl(baseUrl, route, savedApiBase) {
  const bases = imageApiBases(baseUrl);
  return (bases.includes(savedApiBase) ? savedApiBase : bases[0]) + route;
}

function channelFor(baseUrl) {
  return CHANNELS.find(channel => channel.baseUrl === baseUrl);
}

function requestBase(input) {
  if (!input.channelId || input.channelId === 'custom') return normalizeBase(input.baseUrl);
  const channel = CHANNELS.find(item => item.id === input.channelId);
  if (!channel) throw new Error('请选择有效的接口渠道');
  return channel.baseUrl;
}
module.exports = {CHANNELS, channelFor, providerFor, normalizeBase, imageApiBases, imageApiUrl, requestBase};
