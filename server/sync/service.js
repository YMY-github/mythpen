const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const db = require('../db');
const local = require('./local');
const { decideGraph:decideSync, graphHeads:findHeads, validateSnapshot,hash } = require('./snapshot');
const {planRetention}=require('./retention');
const {retryable,category}=require('./errors');

class SyncService {
  constructor({ store, accountId, stateFile, isActive = () => true, canApply = () => true }) {
    this.store = store; this.accountId = accountId; this.isActive = isActive; this.canApply = canApply;
    this.file = stateFile || path.join(db.DB_DIR, `sync-${createHash('sha256').update(accountId).digest('hex')}.json`);
    this.state = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file,'utf8')) : { projects: {} };
    this.running = new Map(); this.results = new Map(); this.failures = new Map();this.revisionCache=new Map();
  }
  check() { if (!this.isActive()) throw new Error('Account disconnected or changed'); }
  save() { this.check(); local.atomicWrite(this.file, JSON.stringify(this.state)); }
  serialized(key, fn) {
    if (this.running.has(key)) throw new Error('Project sync is busy');
    const task = Promise.resolve().then(fn).finally(() => this.running.delete(key));
    this.running.set(key, task); return task;
  }
  metadata(revision) {
    return { revisionId:revision.revisionId,createdAt:revision.createdAt,deviceId:revision.deviceId,bytes:revision.files.reduce((n,f)=>n+f.size,0) };
  }
  async revisions(projectId) {
    this.check();
    const files = await this.store.listFiles(projectId);
    this.check();
    const byId=new Map();
    for (const file of new Map(files.map(file=>[file.id,file])).values()) {
      const cacheKey=file.version && file.md5Checksum ? `${file.id}:${file.version}:${file.md5Checksum}` : null;
      const cached=cacheKey && this.revisionCache.get(cacheKey);
      if(cached) {const previous=byId.get(cached.revisionId);if(previous && previous.fingerprint!==cached.fingerprint) throw new Error('Revision identity collision');byId.set(cached.revisionId,{...cached,file});continue;}
      const revision=await this.store.download(file);validateSnapshot(revision);this.check();
      const fingerprint=hash(JSON.stringify(revision)),previous=byId.get(revision.revisionId);
      if(previous && previous.fingerprint!==fingerprint) throw new Error('Revision identity collision');
      if(!previous) byId.set(revision.revisionId,{projectId:revision.projectId,revisionId:revision.revisionId,parents:revision.parents,
        createdAt:revision.createdAt,deviceId:revision.deviceId,contentHash:revision.contentHash,
        files:revision.files.map(({name,size,sha256})=>({name,size,sha256})),file,fingerprint});
      if(cacheKey) {this.revisionCache.set(cacheKey,byId.get(revision.revisionId));if(this.revisionCache.size>10000)this.revisionCache.delete(this.revisionCache.keys().next().value);}
    }
    const revisions=[...byId.values()];
    findHeads(revisions); return revisions;
  }
  async downloadRevision(revision) {
    const snapshot=await this.store.download(revision.file);validateSnapshot(snapshot);this.check();
    if(hash(JSON.stringify(snapshot))!==revision.fingerprint) throw new Error('Remote revision changed after validation');
    return snapshot;
  }
  status(name) {
    const snapshot=local.capture(name), baseline=this.state.projects[snapshot.projectId];
    return {enabled:!!baseline?.enabled,auto:!!baseline?.auto,busy:this.running.has(name),currentHash:snapshot.contentHash,lastSync:baseline?.lastSync || null,...this.results.get(name),pending:!!baseline?.enabled && baseline.hash!==snapshot.contentHash};
  }
  enable(name, auto=false) {
    this.check();const snapshot=local.capture(name);
    this.state.projects[snapshot.projectId]={...this.state.projects[snapshot.projectId],name,enabled:true,auto:!!auto};this.save();
    return this.status(name);
  }
  disable(name) {
    if (this.running.has(name)) throw new Error('Wait for the current sync before disabling');
    const snapshot=local.capture(name),baseline=this.state.projects[snapshot.projectId];
    if (baseline) {baseline.enabled=false;baseline.auto=false;this.save();}
    return this.status(name);
  }
  baseline(name,snapshot) {
    this.check();
    const previous=this.state.projects[snapshot.projectId] || {};
    this.state.projects[snapshot.projectId]={...previous,name,enabled:true,revisionId:snapshot.revisionId,hash:snapshot.contentHash,lastSync:new Date().toISOString()};
    this.save();
  }
  async sync(name) {
    return this.serialized(name,async()=> {
      this.check();
      const start=local.capture(name),base=this.state.projects[start.projectId];
      if (!base?.enabled) throw new Error('Enable cloud sync for this project first');
      try {
        const revisions=await this.revisions(start.projectId);
        // Local edits during remote reads participate in conflict detection.
        const current=local.capture(name);
        const decision=decideSync({localHash:current.contentHash,baseHash:base.hash,baseRevision:base.revisionId,revisions});
        let result={action:decision.action};
        if (decision.action==='upload') {
          const snapshot=local.capture(name,decision.parents);
          local.saveBackup(snapshot);
          await this.store.upload(snapshot);this.check();
          this.baseline(name,snapshot);
          const heads=findHeads(await this.revisions(snapshot.projectId));
          result=heads.length>1 ? {action:'conflict',heads:heads.map(r=>this.metadata(r)),expectedHash:local.capture(name).contentHash} : {action:'uploaded',pending:local.capture(name).contentHash!==snapshot.contentHash};
        } else if (decision.action==='unchanged') {
          this.baseline(name,decision.revision);result={action:'synced'};
        } else if (decision.action==='download') {
          // Automatic backend jobs never replace an editor's active data.
          result={action:'download-ready',revision:this.metadata(decision.revision),expectedHash:current.contentHash};
        } else if (decision.action==='conflict') result={action:'conflict',heads:findHeads(revisions).map(r=>this.metadata(r)),expectedHash:current.contentHash};
        this.failures.delete(name);this.results.set(name,result);return result;
      } catch(error) {
        const attempts=(this.failures.get(name) || 0)+1;this.failures.set(name,attempts);
        const requiresAction=!retryable(error);
        const retryAt=Date.now()+Math.min(300000,30000*2**Math.min(attempts-1,4))*(1+Math.random()*0.2);
        this.results.set(name,{action:'error',errorCode:category(error),requiresAction,retryAt});throw error;
      }
    });
  }
  async history(name) {return (await this.revisions(local.capture(name).projectId)).map(s=>this.metadata(s)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  async retentionInventory(name,keep) {
    const current=local.capture(name),files=await this.store.listFiles(current.projectId),revisions=[];
    for(const file of new Map(files.map(file=>[file.id,file])).values()) {
      // Read one validated snapshot at a time; do not keep all history bodies
      // in memory, even when planning cleanup for a long-lived project.
      const revision=await this.store.download(file);validateSnapshot(revision);this.check();
      revisions.push({projectId:revision.projectId,revisionId:revision.revisionId,parents:revision.parents,createdAt:revision.createdAt,
        contentHash:revision.contentHash,fileId:file.id,bytes:revision.files.reduce((n,f)=>n+f.size,0),
        fingerprint:createHash('sha256').update(JSON.stringify(revision)).digest('hex')});
    }
    if(local.capture(name).contentHash!==current.contentHash) throw new Error('Local project changed; preview cleanup again');
    const baseline=this.state.projects[current.projectId];
    return planRetention({revisions,keep,baselineId:baseline?.revisionId,currentHash:current.contentHash});
  }
  async previewRetention(name,keep) {
    return this.serialized(name,async()=> {this.check();const {fileIds,...plan}=await this.retentionInventory(name,keep);return plan;});
  }
  async cleanHistory(name,keep,token,confirmed) {
    if(confirmed!=='permanently-delete-listed-history') throw new Error('Explicit history deletion confirmation required');
    return this.serialized(name,async()=> {
      this.check();const plan=await this.retentionInventory(name,keep);
      if(plan.token!==token) throw new Error('Cloud or local versions changed; preview cleanup again');
      let removed=0;
      for(const file of plan.fileIds) {this.check();await this.store.remove(file);removed++;}
      return {removed};
    });
  }
  async discover() {
    const files=await this.store.listFiles();this.check();
    const ids=[...new Set(files.map(f=>f.appProperties?.projectId).filter(Boolean))];
    const projects=[];
    for (const id of ids) {
      const revisions=await this.revisions(id),heads=findHeads(revisions);
      if (!heads.length) continue;
      const files=validateSnapshot(await this.downloadRevision(heads[0]));
      db.validateProjectBytes(files.get('project.db'),id);
      const meta=db.projectMetaFromBytes(files.get('project.db'));
      projects.push({projectId:id,name:meta.name || 'Untitled',heads:heads.map(r=>this.metadata(r))});
    }
    return projects;
  }
  async import(projectId,revisionId,name) {
    return this.serialized(name,async()=> {
      if (db.projectExists(name)) throw new Error('Local project name already exists');
      const revisions=await this.revisions(projectId);
      const revision=revisions.find(r=>r.revisionId===revisionId);
      if (!revision) throw new Error('Remote revision not found');
      const snapshot=await this.downloadRevision(revision);
      this.check();if (!this.canApply()) throw new Error('Writing or AI generation is still in progress');local.importProject(name,snapshot);
      this.baseline(name,revision);return {action:'imported'};
    });
  }
  async apply(name,revisionId,expectedHash,choice) {
    return this.serialized(name,async()=> {
      const initial=local.capture(name);
      const revisions=await this.revisions(initial.projectId);
      const revision=revisions.find(r=>r.revisionId===revisionId);
      if (!revision) throw new Error('Remote revision not found');
      const snapshot=await this.downloadRevision(revision);
      const current=local.capture(name);
      if (current.contentHash!==expectedHash) throw new Error('Local project changed; check sync again');
      if (!this.canApply()) throw new Error('Writing or AI generation is still in progress');
      if (choice==='copy') {
        const copyName=`${name.slice(0,70)} (${randomUUID().slice(0,8)})`;
        local.importProject(copyName,snapshot,true);
        return {action:'copied',name:copyName};
      }
      if (!['restore','download'].includes(choice)) throw new Error('Invalid recovery choice');
      const headsBefore=findHeads(revisions);
      if (choice==='download' && (headsBefore.length!==1 || headsBefore[0].revisionId!==revisionId)) throw new Error('Remote version changed; sync again');
      this.check();if (!this.canApply()) throw new Error('Writing or AI generation is still in progress');const restored=local.restore(name,snapshot,expectedHash);
      // Restoring is new local work, not an adoption of the old cloud baseline.
      local.saveBackup(restored);this.results.set(name,{action:'restored'});
      const heads=findHeads(revisions);
      if (choice==='download' && (heads.length!==1 || heads[0].revisionId!==revisionId)) throw new Error('Remote version changed; sync again');
      if (heads.length===1) this.baseline(name,heads[0]);
      return {action:'restored'};
    });
  }
  async resolveLocal(name,expectedHash) {
    return this.serialized(name,async()=> {
      const initial=local.capture(name),revisions=await this.revisions(initial.projectId);
      const current=local.capture(name);
      if(current.contentHash!==expectedHash) throw new Error('Local project changed; check sync again');
      // All losing revisions are retained as immutable cloud history.
      const resolved=local.capture(name,findHeads(revisions).map(r=>r.revisionId));
      local.saveBackup(resolved);await this.store.upload(resolved);this.check();this.baseline(name,resolved);
      this.results.set(name,{action:'uploaded'});return {action:'uploaded'};
    });
  }
  canAutoSync(name) {
    const result=this.results.get(name);
    if (!result) return true;
    return !['conflict','download-ready','remote-missing'].includes(result.action) && !result.requiresAction && (!result.retryAt || Date.now()>=result.retryAt);
  }
  async tick() {
    for (const project of Object.values(this.state.projects)) {
      if (!this.isActive()) break;
      if(project.enabled && project.auto && this.canAutoSync(project.name) && db.projectExists(project.name)) {
        try {await this.sync(project.name);} catch { /* Status is retained for UI; next tick retries. */ }
      }
    }
  }
}
module.exports={SyncService};
