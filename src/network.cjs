const { Agent, EnvHttpProxyAgent, fetch: undiciFetch } = require('undici');

// Electron's network stack follows Windows proxy, PAC and VPN settings,
// including SOCKS proxies. Undici is retained for non-Electron tests/tools.
const environmentDispatcher = new EnvHttpProxyAgent();
const directDispatcher = new Agent();

function proxyConnectionFailed(error) {
  const detail = `${error?.message || ''} ${error?.cause?.message || ''} ${error?.cause?.code || ''}`;
  return /ERR_PROXY_CONNECTION_FAILED|ERR_SOCKS_CONNECTION_FAILED|ERR_NO_SUPPORTED_PROXIES|ERR_TUNNEL_CONNECTION_FAILED/i.test(detail);
}

function desktopFetch() {
  try {
    const electron = require('electron');
    if (typeof electron?.net?.fetch === 'function') return electron.net.fetch.bind(electron.net);
  } catch {}
  return null;
}

async function networkFetch(url, options = {}) {
  const fetcher = desktopFetch();
  try {
    return fetcher
      ? await fetcher(url, options)
      : await undiciFetch(url, { ...options, dispatcher: environmentDispatcher });
  } catch (error) {
    if (fetcher && proxyConnectionFailed(error)) {
      try { return await undiciFetch(url, { ...options, dispatcher: directDispatcher }); }
      catch (directError) { throw new Error(`系统代理与直连均无法访问接口：${directError.message}`, { cause: directError }); }
    }
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      throw new Error('连接接口超时，请稍后重试', { cause: error });
    }
    const detail = String(error?.message || error?.cause?.code || '连接失败');
    throw new Error(`无法连接接口：${detail}`, { cause: error });
  }
}

module.exports = { networkFetch, desktopFetch, proxyConnectionFailed };
