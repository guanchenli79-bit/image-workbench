const { EnvHttpProxyAgent, fetch } = require('undici');

// Electron's Node fetch ignores the system proxy. Undici reads HTTP(S)_PROXY
// and NO_PROXY, which matches the proxy settings used on this machine.
const dispatcher = new EnvHttpProxyAgent();

async function networkFetch(url, options = {}) {
  try {
    return await fetch(url, { ...options, dispatcher });
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      throw new Error('连接接口超时，请检查网络或代理设置', { cause: error });
    }
    throw new Error('无法连接接口，请检查网络、系统代理及接口地址', { cause: error });
  }
}

module.exports = { networkFetch };
