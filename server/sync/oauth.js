const http = require('node:http');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

// Platform credential vault is mandatory. No plaintext disk fallback.
class GoogleOAuth {
  constructor({ clientId, clientSecret = '', vault, fetchImpl = fetch }) {
    if (!clientId || !vault) throw new Error('Google client configuration and secure vault required');
    this.clientId = clientId; this.clientSecret = clientSecret;
    this.vault = vault; this.fetch = fetchImpl; this.generation = 0; this.vaultQueue = Promise.resolve();
  }
  mutateVault(fn) {
    const task = this.vaultQueue.then(fn);
    this.vaultQueue = task.catch(() => {});
    return task;
  }
  async tokenRequest(values) {
    const response = await this.fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, ...(this.clientSecret ? { client_secret: this.clientSecret } : {}), ...values }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) { const error=new Error(`Google authorization failed (${response.status})`);error.status=response.status;error.retryable=response.status===429 || response.status>=500;throw error; }
    const tokens = await response.json();
    if (!tokens.access_token || !Number.isFinite(tokens.expires_in)) throw new Error('Invalid Google token response');
    return { ...tokens, expiresAt: Date.now() + tokens.expires_in * 1000 };
  }
  async begin() {
    this.cancel?.();
    const generation = ++this.generation;
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    let resolve, reject, timer;
    const result = new Promise((yes,no) => { resolve=yes; reject=no; });
    // Consumer receives the original promise, with no unhandled rejection on cancellation.
    result.catch(() => {});
    let settled=false;
    const finish=(error,tokens)=> {
      if (settled) return;
      settled=true; if (error && this.generation===generation) ++this.generation; clearTimeout(timer); server.close();
      if (error) reject(error); else resolve(tokens);
    };
    const server = http.createServer(async (req,res) => {
      const url = new URL(req.url,'http://127.0.0.1');
      if (req.method !== 'GET' || url.pathname !== '/callback') { res.writeHead(404).end(); return; }
      const actual = Buffer.from(url.searchParams.get('state') || '');
      const expected = Buffer.from(state);
      if (actual.length !== expected.length || !timingSafeEqual(actual,expected)) { res.writeHead(400).end('Invalid authorization state.'); return; }
      if (settled) { res.writeHead(409).end(); return; }
      const code=url.searchParams.get('code');
      if (url.searchParams.has('error') || !code) { res.writeHead(400).end('Authorization cancelled.'); finish(new Error('Authorization cancelled')); return; }
      res.writeHead(200,{'Content-Type':'text/plain; charset=utf-8'}).end('You may close this window and return to Mythpen.');
      // Close the listener before exchange so one code cannot be processed twice.
      server.close();
      try {
        const tokens=await this.tokenRequest({grant_type:'authorization_code',code,redirect_uri:redirect,code_verifier:verifier});
        if (generation !== this.generation) throw new Error('Authorization cancelled');
        if (!tokens.refresh_token) throw new Error('Offline authorization was not granted');
        await this.mutateVault(async () => { if (generation !== this.generation) throw new Error('Authorization cancelled'); await this.vault.set(tokens); });
        if (generation !== this.generation) { throw new Error('Authorization cancelled'); }
        finish(null,{connected:true});
      } catch(error) { finish(error); }
    });
    await new Promise((yes,no)=> {server.once('error',no);server.listen(0,'127.0.0.1',yes);});
    const redirect=`http://127.0.0.1:${server.address().port}/callback`;
    this.cancel=()=> { ++this.generation; finish(new Error('Authorization cancelled')); };
    // Allow time for first-time Google consent and multi-factor authentication.
    timer=setTimeout(()=>finish(new Error('Authorization timed out')),10*60*1000);
    timer.unref();
    const params=new URLSearchParams({client_id:this.clientId,redirect_uri:redirect,response_type:'code',scope:SCOPE,state,code_challenge:challenge,code_challenge_method:'S256',access_type:'offline',prompt:'consent'});
    return {url:`https://accounts.google.com/o/oauth2/v2/auth?${params}`,result,cancel:this.cancel};
  }
  async getToken() {
    if (this.refreshing) return this.refreshing;
    const generation=this.generation;
    const saved=await this.vault.get();
    if (this.refreshing) return this.refreshing;
    if (!saved || generation !== this.generation) throw new Error('Google account is not connected');
    if (saved.expiresAt > Date.now()+60000) return saved.access_token;
    this.refreshing=(async()=> {
      const fresh=await this.tokenRequest({grant_type:'refresh_token',refresh_token:saved.refresh_token});
      if (generation !== this.generation) throw new Error('Google account disconnected');
      await this.mutateVault(async () => { if (generation !== this.generation) throw new Error('Google account disconnected'); await this.vault.set({...saved,...fresh,refresh_token:fresh.refresh_token || saved.refresh_token}); });
      if (generation !== this.generation) {throw new Error('Google account disconnected');}
      return fresh.access_token;
    })();
    try {return await this.refreshing;} finally {this.refreshing=null;}
  }
  async disconnect() { this.cancel?.(); ++this.generation; await this.mutateVault(() => this.vault.clear()); }
}
module.exports={GoogleOAuth,SCOPE};
