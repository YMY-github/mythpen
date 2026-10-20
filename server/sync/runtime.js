const fs=require('node:fs');
const path=require('node:path');
const db=require('../db');
const local=require('./local');
const {GoogleOAuth}=require('./oauth');
const {SecureVault}=require('./vault');
const {GoogleDriveStore}=require('./drive');
const {SyncService}=require('./service');
const {publicError}=require('./errors');

class SyncRuntime {
  constructor() {this.epoch=0;this.phase='disconnected';this.timer=null;this.message='';this.delays=new Map();}
  configFile() {return path.join(db.DB_DIR,'google-client.json');}
  config() {return fs.existsSync(this.configFile()) ? JSON.parse(fs.readFileSync(this.configFile(),'utf8')) : null;}
  async configure(input) {
    if (this.oauth || this.phase==='connecting') throw new Error('Disconnect before changing Google client');
    const config=input.installed || input;
    if (typeof config.client_id!=='string' || !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(config.client_id)) throw new Error('Import a Google Desktop OAuth client JSON');
    if (config.client_secret!==undefined && (typeof config.client_secret!=='string' || config.client_secret.length>512)) throw new Error('Invalid client configuration');
    local.atomicWrite(this.configFile(),JSON.stringify({client_id:config.client_id,client_secret:config.client_secret || ''}));
    return this.status();
  }
  initialize() {
    if (this.oauth) return;
    const config=this.config();if (!config) throw new Error('Configure a Google Desktop OAuth client first');
    this.vault=new SecureVault(config.client_id,db.DB_DIR);
    this.oauth=new GoogleOAuth({clientId:config.client_id,clientSecret:config.client_secret,vault:this.vault});
  }
  async activate() {
    if (this.phase==='disconnecting') throw new Error('Account is disconnecting');
    if (this.service) return this.service;
    this.initialize();
    if (this.activating) return this.activating;
    const epoch=this.epoch;
    this.activating=(async()=> {
      const saved=await this.vault.get();
      if (!saved?.accountId) throw new Error('Connect Google first');
      if(epoch!==this.epoch) throw new Error('Account changed');
      this.controller=new AbortController();
      const oauth=this.oauth;
      this.store=new GoogleDriveStore({getToken:()=>oauth.getToken(),signal:this.controller.signal});
      this.service=new SyncService({store:this.store,accountId:`${this.config().client_id}:${saved.accountId}`,isActive:()=>epoch===this.epoch,canApply:()=>this.canApply?.() !== false});
      this.phase='connected';this.message='';this.account=saved.accountName || saved.accountId;
      return this.service;
    })();
    try {return await this.activating;} finally {this.activating=null;}
  }
  async connect() {
    this.initialize();
    if (await this.vault.get()) throw new Error('Disconnect before connecting a different account');
    const epoch=++this.epoch;
    const flow=await this.oauth.begin();this.phase='connecting';this.message='';
    flow.result.then(async()=> {
      if(epoch!==this.epoch) return;
      const store=new GoogleDriveStore({getToken:()=>this.oauth.getToken()});
      const response=await store.request('https://www.googleapis.com/drive/v3/about?fields=user(permissionId,emailAddress,displayName)');
      const {user}=await response.json();
      if (!user?.permissionId) throw new Error('Unable to identify Google account');
      if(epoch!==this.epoch) return;
      await this.oauth.mutateVault(async()=> {
        if(epoch!==this.epoch) return;
        const tokens=await this.vault.get();
        await this.vault.set({...tokens,accountId:user.permissionId,accountName:user.emailAddress || user.displayName});
      });
      if(epoch===this.epoch) await this.activate();
    }).catch(async error=> {
      if(epoch!==this.epoch) return;
      this.phase='disconnected';this.message=publicError(error).message;this.errorCode=publicError(error).code;
      await this.oauth.disconnect().catch(()=>{});
    });
    return {url:flow.url};
  }
  async disconnect() {
    ++this.epoch;this.phase='disconnecting';this.controller?.abort();
    if(this.oauth) await this.oauth.disconnect();
    this.service=null;this.store=null;this.account=null;this.phase='disconnected';this.message='';this.oauth=null;
    return this.status();
  }
  async status() {
    const config=this.config();
    if(config && !['connecting','disconnecting'].includes(this.phase) && !this.service) {
      try {await this.activate();} catch(error) {if(!/Connect Google first/.test(error.message)) {const safe=publicError(error);this.message=safe.message;this.errorCode=safe.code;}}
    }
    return {configured:!!config,clientId:config?.client_id || '',phase:this.phase,account:this.account || null,message:this.message,errorCode:this.message ? this.errorCode : null};
  }
  start() {
    this.unobserve=db.onProjectChanged(name => {
      const project=Object.values(this.service?.state.projects || {}).find(p=>p.name===name);
      if(!project?.enabled || !project.auto) return;
      clearTimeout(this.delays.get(name));
      const epoch=this.epoch;
      const timer=setTimeout(async()=> {
        this.delays.delete(name);
        if(epoch!==this.epoch || !Object.values(this.service?.state.projects || {}).some(p=>p.name===name && p.auto && p.enabled) || !this.service?.canAutoSync(name)) return;
        try {await this.service?.sync(name);} catch { /* Retry on the periodic check. */ }
      },30000);
      timer.unref();this.delays.set(name,timer);
    });
    this.timer=setInterval(async()=> {
      if(this.phase==='connecting') return;
      try {await (await this.activate()).tick();} catch { /* UI status exposes setup/auth errors. */ }
    },120000);
    this.timer.unref();
  }
  async wake() {
    // Focus and network events can arrive together; avoid a request storm.
    if (this.phase==='connecting' || this.phase==='disconnecting' || (this.lastWake && Date.now()-this.lastWake<30000)) return;
    this.lastWake=Date.now();
    await (await this.activate()).tick();
  }
  diagnostics() {
    const projects=Object.values(this.service?.state.projects || {});
    return {formatVersion:1,appVersion:require('../../package.json').version,platform:process.platform,architecture:process.arch,
      secureStorageSupported:['darwin','win32'].includes(process.platform),googleConfigured:!!this.config(),connectionPhase:this.phase,
      enabledProjects:projects.filter(project=>project.enabled).length,autoUploadProjects:projects.filter(project=>project.enabled && project.auto).length,
      resultCounts:[...(this.service?.results?.values() || [])].reduce((out,result)=>{out[result.action]=(out[result.action] || 0)+1;return out;},{}),
      limits:{snapshotMiB:64,historyFiles:10000},telemetry:false};
  }
  stop() {this.unobserve?.();for(const timer of this.delays.values()) clearTimeout(timer);this.delays.clear();clearInterval(this.timer);this.controller?.abort();this.oauth?.cancel?.();}
}
module.exports={SyncRuntime};
