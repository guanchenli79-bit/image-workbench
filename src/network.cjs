const { EnvHttpProxyAgent, ProxyAgent, fetch } = require('undici');

// Node fetch ignores Windows proxy settings. Use environment proxy settings when
// provided, and Electron's Windows/PAC proxy resolver for desktop launches.
const environmentDispatcher = new EnvHttpProxyAgent();
const proxyDispatchers = new Map();

async function dispatcherFor(url) {
  const protocol = new URL(url).protocol;
  const configured = protocol === 'https:' ? process.env.HTTPS_PROXY || process.env.https_proxy
    : process.env.HTTP_PROXY || process.env.http_proxy;
  if (configured) return environmentDispatcher;
  let electron;
  try { electron = require('electron'); } catch { return environmentDispatcher; }
  const resolveProxy = electron?.session?.defaultSession?.resolveProxy;
  if (!resolveProxy) return environmentDispatcher;
  const rule = (await resolveProxy.call(electron.session.defaultSession, String(url))).split(';')[0].trim();
  const match = /^(PROXY|HTTPS)\s+(.+)$/i.exec(rule);
  if (!match) return environmentDispatcher;
  const proxyUrl = `${match[1].toUpperCase() === 'HTTPS' ? 'https' : 'http'}://${match[2]}`;
  if (!proxyDispatchers.has(proxyUrl)) proxyDispatchers.set(proxyUrl, new ProxyAgent(proxyUrl));
  return proxyDispatchers.get(proxyUrl);
}

async function networkFetch(url, options = {}) {
  try {
    return await fetch(url, { ...options, dispatcher: await dispatcherFor(url) });
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      throw new Error('?????????????????', { cause: error });
    }
    throw new Error('??????????????????????', { cause: error });
  }
}

module.exports = { networkFetch, dispatcherFor };
