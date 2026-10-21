const test=require('node:test');
const assert=require('node:assert/strict');
const {proxyConnectionFailed}=require('../src/network.cjs');

test('只对明确的代理建连错误开放直连回退',()=>{
  assert.equal(proxyConnectionFailed(new Error('net::ERR_PROXY_CONNECTION_FAILED')),true);
  assert.equal(proxyConnectionFailed(new Error('net::ERR_SOCKS_CONNECTION_FAILED')),true);
  assert.equal(proxyConnectionFailed(new Error('net::ERR_TIMED_OUT')),false);
  assert.equal(proxyConnectionFailed(new Error('HTTP 500')),false);
});
