const CHANNELS = [
  {id:'one', label:'渠道一', baseUrl:'https://grsaiapi.com', provider:'grsai'},
  {id:'two', label:'渠道二', baseUrl:'https://ark.cn-beijing.volces.com/api/v3', provider:'ark'}
];
const ARK_HOST = 'ark.cn-beijing.volces.com';
function channelFor(baseUrl) {
  const url = new URL(baseUrl);
  if (['grsaiapi.com','grsai.dakka.com.cn'].includes(url.hostname) &&
      url.protocol === 'https:' && !url.port && url.pathname === '/') return CHANNELS[0];
  return CHANNELS.find(channel => channel.baseUrl === baseUrl);
}
function requestBase(input, normalizeBase) {
  if (!input.channelId || input.channelId === 'custom') return normalizeBase(input.baseUrl);
  const channel = CHANNELS.find(item => item.id === input.channelId);
  if (!channel) throw new Error('请选择有效的接口渠道');
  return channel.baseUrl;
}
module.exports = {CHANNELS, ARK_HOST, channelFor, requestBase};
