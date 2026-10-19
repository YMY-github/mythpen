const { createHash } = require('node:crypto');

class SecureVault {
  constructor(clientId, dataDir, EntryClass) {
    if (!['darwin','win32'].includes(process.platform) && !EntryClass) throw new Error('Secure storage supports macOS and Windows only');
    const { AsyncEntry } = EntryClass ? { AsyncEntry: EntryClass } : require(process.env.MYTHPEN_KEYRING_DIR || '@napi-rs/keyring');
    const identity = createHash('sha256').update(`${dataDir}\n${clientId}`).digest('hex');
    this.entry = new AsyncEntry('community.mythpen.sync.dev', identity);
  }
  async get() {
    const raw = await this.entry.getPassword();
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data.access_token || !data.refresh_token) throw new Error('Invalid stored authorization; reconnect Google');
    return data;
  }
  async set(tokens) { await this.entry.setPassword(JSON.stringify(tokens)); }
  async clear() { await this.entry.deleteCredential(); }
}
module.exports = { SecureVault };
