const { validateSnapshot, MAX_BYTES } = require('./snapshot');
const {retryable}=require('./errors');
const {setTimeout:delay}=require('node:timers/promises');

// Tokens are injected by the credential service; this adapter never persists them.
// Immutable revisions in appDataFolder; no conditional update claim or last-writer wins.
class GoogleDriveStore {
  constructor({ getToken, fetchImpl = fetch, signal }) { this.getToken = getToken; this.fetch = fetchImpl; this.signal = signal; }

  async request(url, options = {}, allowedStatuses = []) {
    const token = await this.getToken();
    const response = await this.fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` }, signal: this.signal ? AbortSignal.any([this.signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
    if (!response.ok && !allowedStatuses.includes(response.status)) {
      const error = new Error(`Google Drive request failed (${response.status})`);
      error.status = response.status;
      error.retryable = response.status === 429 || response.status >= 500;
      let reason;
      try {reason=(await response.json())?.error?.errors?.[0]?.reason;} catch { /* Status still identifies the error. */ }
      if(reason==='storageQuotaExceeded') error.category='quota';
      if(['rateLimitExceeded','userRateLimitExceeded'].includes(reason)) {error.category='network';error.retryable=true;}
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
    const payload=JSON.stringify(snapshot);
    let file;
    if(Buffer.byteLength(payload)>5*1024*1024) file=await this.uploadResumable(metadata,Buffer.from(payload));
    else {
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${payload}\r\n--${boundary}--\r\n`;
      const response = await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size,appProperties', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
      file=await response.json();
    }
    const downloaded = await this.download(file);
    if (JSON.stringify(downloaded) !== JSON.stringify(snapshot)) throw new Error('Upload verification failed');
    return file;
  }
  async uploadResumable(metadata,body) {
    const start=await this.request('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,appProperties',{
      method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':'application/json','X-Upload-Content-Length':String(body.length)},body:JSON.stringify(metadata),redirect:'error'});
    let session;
    try {session=new URL(start.headers.get('Location'));} catch {throw new Error('Invalid upload session identity');}
    if(session.protocol!=='https:' || session.hostname!=='www.googleapis.com' || session.port || session.username || session.password || !session.pathname.startsWith('/upload/drive/')) throw new Error('Untrusted upload session identity');
    const chunkSize=8*1024*1024;
    let offset=0,failures=0,stalls=0;
    while(true) {
      const end=Math.min(offset+chunkSize,body.length);
      let response;
      try {
        response=await this.request(session.href,{method:'PUT',headers:{'Content-Type':'application/json','Content-Length':String(end-offset),
          'Content-Range':offset<body.length ? `bytes ${offset}-${end-1}/${body.length}` : `bytes */${body.length}`},
          ...(offset<body.length?{body:body.subarray(offset,end)}:{}),redirect:'manual'},[308]);
      } catch(error) {
        if(this.signal?.aborted || !retryable(error) || ++failures>3) throw error;
        await delay(250*failures);
        response=await this.request(session.href,{method:'PUT',headers:{'Content-Length':'0','Content-Range':`bytes */${body.length}`},redirect:'manual'},[308]);
      }
      if(response.status!==308) return response.json();
      const range=response.headers.get('Range');
      if(range && !/^bytes=0-\d+$/.test(range)) throw new Error('Invalid resumable upload range');
      const next=range?Number(range.slice(8))+1:0;
      if(!Number.isSafeInteger(next) || next<offset || next>end) throw new Error('Invalid resumable upload progress');
      if(next===offset) {
        if(++stalls>3) throw Object.assign(new Error('Upload made no progress'),{retryable:true});
      } else {stalls=0;failures=0;}
      offset=next;
    }
  }
  async remove(fileId) {
    if(!/^[a-zA-Z0-9_-]+$/.test(fileId)) throw new Error('Invalid remote file');
    await this.request(`https://www.googleapis.com/drive/v3/files/${fileId}`,{method:'DELETE'});
  }
}
module.exports = { GoogleDriveStore };
