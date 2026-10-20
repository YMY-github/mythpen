// Cloud-first document experience for one person alternating between devices.
// Immutable storage remains an implementation detail; no version selection UI.
const db=require('../db');
const local=require('./local');
const {SyncService}=require('./service');
const {graphHeads}=require('./snapshot');
const {retryable,category}=require('./errors');

function latest(revisions) {
  return graphHeads(revisions).sort((a,b)=>{
    // Drive creation time is assigned by Google, independent of device clocks.
    const left=a.file?.modifiedTime || a.file?.createdTime || a.createdAt,right=b.file?.modifiedTime || b.file?.createdTime || b.createdAt;
    return right.localeCompare(left) || b.revisionId.localeCompare(a.revisionId);
  })[0];
}

class CloudDocuments extends SyncService {
  adopt(name,revision) {
    this.check();const current=local.capture(name);
    this.state.projects[current.projectId]={...this.state.projects[current.projectId],name,enabled:true,auto:true,
      revisionId:revision.revisionId,remoteHash:revision.contentHash,hash:current.contentHash,lastSync:new Date().toISOString()};
    this.save();
  }
  async sync(name) {
    if(this.running.has(name))return this.running.get(name);
    return this.serialized(name,async()=>{
      this.check();const start=local.capture(name);
      let base=this.state.projects[start.projectId];
      if(!base?.enabled || !base?.auto) {this.enable(name,true);base=this.state.projects[start.projectId];}
      try {
        const revisions=await this.revisions(start.projectId),remote=latest(revisions),current=local.capture(name);
        let result;
        if(!remote && base?.revisionId) result={action:'remote-missing'};
        else if(remote && remote.revisionId===base?.revisionId && remote.contentHash!==(base.remoteHash || base.hash)) throw new Error('Remote immutable revision changed');
        else if(remote && current.contentHash===remote.contentHash) {this.adopt(name,remote);result={action:'synced'};}
        else if(remote && remote.revisionId!==base?.revisionId) {
          // Cloud is authoritative, including when an offline local edit exists.
          // The UI applies this automatically only after its editor is saved/locked.
          result={action:'download-ready',expectedHash:current.contentHash};
        } else if(remote && current.contentHash===base?.hash) result={action:'synced'};
        else {
          const heads=graphHeads(revisions),parents=[...(remote?[remote.revisionId]:[]),...heads.map(r=>r.revisionId)];
          const snapshot=local.capture(name,[...new Set(parents)].slice(0,16));
          await (this.store.uploadDocument ? this.store.uploadDocument(snapshot) : this.store.upload(snapshot));this.check();
          this.state.projects[snapshot.projectId]={...base,name,enabled:true,auto:true,revisionId:snapshot.revisionId,
            remoteHash:snapshot.contentHash,hash:snapshot.contentHash,lastSync:new Date().toISOString()};this.save();
          const newest=latest(await this.revisions(snapshot.projectId));
          result=newest && newest.revisionId!==snapshot.revisionId ? {action:'download-ready',expectedHash:local.capture(name).contentHash} : {action:'uploaded'};
        }
        this.failures.delete(name);this.results.set(name,result);return {...result,...this.status(name)};
      } catch(error) {
        const attempts=(this.failures.get(name)||0)+1;this.failures.set(name,attempts);
        this.results.set(name,{action:'error',errorCode:category(error),requiresAction:!retryable(error),retryAt:Date.now()+Math.min(60000,2000*2**Math.min(attempts-1,5))});throw error;
      }
    });
  }
  async applyLatest(name,expectedHash,allowed=()=>true) {
    return this.serialized(name,async()=>{
      const initial=local.capture(name),remote=latest(await this.revisions(initial.projectId));
      if(!remote) throw new Error('Remote snapshot is missing');
      const snapshot=await this.downloadRevision(remote);
      this.check();
      if(!allowed() || !this.canApply()) throw new Error('Writing or request changed; retry later');
      if(local.capture(name).contentHash!==expectedHash) throw new Error('Local project changed; retry later');
      // Atomic replacement saves the current local draft as a recovery point.
      // No network await is allowed between this guard and replacement.
      local.restore(name,snapshot,expectedHash);this.adopt(name,remote);
      this.results.set(name,{action:'synced'});return {...this.status(name),action:'applied'};
    });
  }
  async open(name,allowed=()=>true) {
    const status=await this.sync(name);
    if(status.action==='download-ready') return this.applyLatest(name,status.expectedHash,allowed);
    return status;
  }
  async automaticCheck(name) {
    const previous=this.results.get(name);
    return previous?.action==='error' && !this.canAutoSync(name) ? this.status(name) : this.sync(name);
  }
  async catalog(allowed=()=>true) {
    if(this.catalogTask)return this.catalogTask;
    this.catalogTask=(async()=>{
      const files=await this.store.listFiles(),locals=db.dbQuery('SELECT name FROM recent_projects'),known=new Set();
      for(const {name} of locals)if(db.projectExists(name))known.add(db.projectGet(name,"SELECT value FROM project_meta WHERE key='sync_project_id'")?.value);
      let imported=0,unavailable=0;
      for(const projectId of new Set(files.map(file=>file.appProperties?.projectId).filter(Boolean))) {
        this.check();if(!allowed())break;
        if(known.has(projectId))continue;
        try {
        const revisions=await this.revisions(projectId),remote=latest(revisions);
        const snapshot=await this.downloadRevision(remote);
        const meta=db.projectMetaFromBytes(require('./snapshot').validateSnapshot(snapshot).get('project.db'));
        let name=meta.name || 'Cloud document';
        try {db.validateProjectName(name);}catch{name=`Cloud document ${projectId.slice(0,8)}`;}
        if(db.projectExists(name))name=`${name.slice(0,85)} (${projectId.slice(0,8)})`;
        let suffix=1;const proposed=name;while(db.projectExists(name))name=`${proposed.slice(0,100)} ${suffix++}`;
        this.check();if(!allowed() || !this.canApply())break;
        local.importProject(name,snapshot);this.adopt(name,remote);known.add(projectId);imported++;
        }catch(error){this.check();if(retryable(error) || ['authorization','permission','quota','credentials','disk-space'].includes(category(error)))throw error;unavailable++;}
      }
      if(allowed())for(const {name} of db.dbQuery('SELECT name FROM recent_projects'))if(db.projectExists(name)) {
        const id=db.projectGet(name,"SELECT value FROM project_meta WHERE key='sync_project_id'")?.value;
        if(!this.state.projects[id]?.enabled || !this.state.projects[id]?.auto)this.enable(name,true);
      }
      this.catalogUnavailable=unavailable;return {imported,unavailable};
    })();
    try{return await this.catalogTask;}finally{this.catalogTask=null;}
  }
  canAutoSync(name) {
    const result=this.results.get(name);
    return !this.running.has(name) && !result?.requiresAction && result?.action!=='remote-missing' && (!result?.retryAt || Date.now()>=result.retryAt);
  }
}
module.exports={CloudDocuments,latest};
