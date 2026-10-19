const test = require('node:test');
const assert = require('node:assert/strict');
const { macProxy, windowsProxy, adoptSystemProxy } = require('../sync/system-proxy');

test('macOS enabled HTTPS proxy is read without adopting disabled settings', () => {
  assert.equal(macProxy('HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 10808'), 'http://127.0.0.1:10808');
  assert.equal(macProxy('HTTPSEnable : 0\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 10808'), null);
  assert.equal(macProxy('HTTPSEnable : 1\nHTTPSProxy : bad/host\nHTTPSPort : 10808'), null);
});

test('Windows shared and protocol-specific proxies are parsed', () => {
  const enabled = 'ProxyEnable    REG_DWORD    0x1\nProxyServer    REG_SZ    ';
  assert.equal(windowsProxy(enabled + '127.0.0.1:10808'), 'http://127.0.0.1:10808');
  assert.equal(windowsProxy(enabled + 'http=127.0.0.1:10808;https=127.0.0.1:10809'), 'http://127.0.0.1:10809');
  assert.equal(windowsProxy(enabled.replace('0x1', '0x0') + '127.0.0.1:10808'), null);
  assert.equal(windowsProxy(enabled + 'http=127.0.0.1:10808'), null);
});

test('desktop adoption preserves explicit proxy and excludes loopback', () => {
  const env = { NO_PROXY: 'example.test' };
  const run = () => 'HTTPSEnable : 1\nHTTPSProxy : 127.0.0.1\nHTTPSPort : 10808';
  adoptSystemProxy(env, 'darwin', run);
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:10808');
  assert.equal(env.NO_PROXY, 'example.test,localhost,127.0.0.1,::1');
  const explicit = { HTTPS_PROXY: 'http://explicit.test:1234' };
  adoptSystemProxy(explicit, 'darwin', () => { throw new Error('must not read system'); });
  assert.deepEqual(explicit, { HTTPS_PROXY: 'http://explicit.test:1234' });
});
