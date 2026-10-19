const { validateSnapshot, MAX_BYTES } = require('./snapshot');

// Tokens are injected by the credential service; this adapter never persists them.
// Immutable revisions in appDataFolder; no conditional update claim or last-writer wins.
class GoogleDriveStore {
  constructor({ getToken, fetchImpl = fetch, signal }) { this.getToken = getToken; this.fetch = fetchImpl; this.signal = signal; }

  async request(url, options = {}) {
    const token = await this.getToken();
    const response = await this.fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` }, signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
    if (!response.ok) {
      const error = new Error(`Google Drive request failed (${response.status})`);
      error.status = response.status;
      error.retryable = response.status === 429 || response.status >= 500;
      throw error;
    }
    return response;
  }

  async listFiles(projectId) {
    if (projectId && !/^[0-9a-f-]{36}$/i.test(projectId)) throw new Error('Invalid project identity');
    const q = `trashed = false and appProperties has { key='mythpenFormat' and value='1' }` + (projectId ? ` and appProperties has { key='projectId' and value='${projectId}' }` : '');
    const files = [];
    let pageToken;
    do {
      const params = new URLSearchParams({ spaces: 'appDataFolder', q, fields: 'nextPageToken,files(id,name,size,appProperties)', pageSize: '100' });
      if (pageToken) params.set('pageToken',pageToken);
      const response = await this.request(`https://www.googleapis.com/drive/v3/files?${params}`);
      const page = await response.json();
      files.push(...(page.files || []));
      if (files.length > 10000) throw new Error('Too many revisions; maintenance needed');
      pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }

  async download(file) {
    if (!/^[a-zA-Z0-9_-]+$/.test(file.id) || Number(file.size) > MAX_BYTES * 1.4) throw new Error('Invalid remote file');
    const response = await this.request(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES * 1.4) throw new Error('Remote snapshot too large');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel(); }
    const snapshot = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    validateSnapshot(snapshot);
    if (file.appProperties?.projectId !== snapshot.projectId || file.appProperties?.revisionId !== snapshot.revisionId) throw new Error('Remote identity mismatch');
    return snapshot;
  }

  async upload(snapshot) {
    validateSnapshot(snapshot);
    // Retrying may produce physical duplicates, but revision IDs remain identical.
    const existing = (await this.listFiles(snapshot.projectId)).find(f => f.appProperties?.revisionId === snapshot.revisionId);
    if (existing) {
      const remote = await this.download(existing);
      if (JSON.stringify(remote) !== JSON.stringify(snapshot)) throw new Error('Remote revision collision');
      return existing;
    }
    const boundary = `mythpen_${snapshot.revisionId}`;
    const metadata = { name: `${snapshot.projectId}.${snapshot.revisionId}.json`, parents: ['appDataFolder'], appProperties: { mythpenFormat: '1', projectId: snapshot.projectId, revisionId: snapshot.revisionId } };
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(snapshot)}\r\n--${boundary}--\r\n`;
    const response = await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,appProperties', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    const file = await response.json();
    const downloaded = await this.download(file);
    if (JSON.stringify(downloaded) !== JSON.stringify(snapshot)) throw new Error('Upload verification failed');
    return file;
  }
}
module.exports = { GoogleDriveStore };
