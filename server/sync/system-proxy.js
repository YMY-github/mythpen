const { execFileSync } = require('node:child_process');

function macProxy(text) {
  const values = Object.fromEntries([...text.matchAll(/^\s*(\w+)\s*:\s*([^\r\n]+)$/gm)].map(match => [match[1], match[2].trim()]));
  if (values.HTTPSEnable !== '1') return null;
  return proxyUrl(values.HTTPSProxy, values.HTTPSPort);
}

function proxyUrl(host, port) {
  if (!host || !/^\d+$/.test(port || '') || Number(port) < 1 || Number(port) > 65535) return null;
  try {
    const url = new URL(`http://${host}:${port}`);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

function windowsProxy(text) {
  if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(text)) return null;
  const value = text.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim();
  if (!value) return null;
  const server = value.includes('=') ? value.split(';').find(item => item.trim().startsWith('https='))?.trim().slice(6) : value;
  const match = server?.match(/^([^\s/:]+):(\d+)$/);
  return match ? proxyUrl(match[1], match[2]) : null;
}

function adoptSystemProxy(env = process.env, platform = process.platform, run = execFileSync) {
  // Explicit environment configuration takes precedence over OS settings.
  if (['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'].some(key => env[key])) return;
  let proxy;
  try {
    const options = { encoding: 'utf8', timeout: 2000, windowsHide: true };
    if (platform === 'darwin') proxy = macProxy(run('/usr/sbin/scutil', ['--proxy'], options));
    if (platform === 'win32') proxy = windowsProxy(run('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], options));
  } catch { return; }
  if (!proxy) return;
  env.HTTPS_PROXY = proxy;
  env.HTTP_PROXY = proxy;
  const exclusions = new Set((env.NO_PROXY || env.no_proxy || '').split(',').filter(Boolean));
  ['localhost', '127.0.0.1', '::1'].forEach(host => exclusions.add(host));
  env.NO_PROXY = [...exclusions].join(',');
}

module.exports = { macProxy, windowsProxy, adoptSystemProxy };
