const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mythpen-service-'));
process.env.MYTHPEN_DATA_DIR=root;
const db=require('../db'),local=require('../sync/local');
const {SyncService}=require('../sync/service');
const {createSnapshot}=require('../sync/snapshot');
const names=[];
before(()=>db.initDatabase());
after(()=>{for(const name of names) db.closeProjectDb(db.getProjectDbPath(name));db.getConfigDb().close();fs.rmSync(root,{recursive:true,force:true});});
function fixture() {
  const name=`test-${randomUUID()}`;names.push(name);
  const project=db.getProjectDb(name);
  project.prepare("INSERT INTO project_meta (key,value) VALUES ('name',?)").run(name);
  project.prepare("INSERT INTO volumes (id,sort_order,title) VALUES (1,1,'卷')").run();
  project.prepare("INSERT INTO chapters (volume_id,num,title,content) VALUES (1,1,'章','初稿')").run();
  db.dbExecute('INSERT INTO recent_projects (id,name,file_path,last_opened,word_count) VALUES (?,?,?,?,?)',[name,name,db.getProjectDbPath(name),new Date().toISOString(),0]);
  const revisions=[];
  const store={
    listFiles:async(projectId)=>revisions.filter(r=>!projectId || r.projectId===projectId).map(r=>({id:r.revisionId,appProperties:{projectId:r.projectId,revisionId:r.revisionId}})),
    download:async(file)=>structuredClone(revisions.find(r=>r.revisionId===file.id)),
    upload:async(snapshot)=>{revisions.push(structuredClone(snapshot));},
  };
  const service=new SyncService({store,accountId:randomUUID()});
  return {name,service,store,revisions};
}
test('manual sync stores baseline and no-op sync avoids duplicate upload',async()=>{
  const {name,service,revisions}=fixture();service.enable(name);
  assert.equal((await service.sync(name)).action,'uploaded');
  assert.equal((await service.sync(name)).action,'synced');assert.equal(revisions.length,1);
  const restarted=new SyncService({store:service.store,accountId:service.accountId});
  assert.equal(restarted.status(name).lastSync,service.status(name).lastSync);
});
test('edits made during upload remain pending and are uploaded next',async()=>{
  const {name,service,store,revisions}=fixture();service.enable(name);
  const upload=store.upload;store.upload=async(snapshot)=>{await upload(snapshot);db.projectExecute(name,"UPDATE chapters SET content='新稿'");};
  assert.equal((await service.sync(name)).pending,true);
  store.upload=upload;assert.equal((await service.sync(name)).action,'uploaded');assert.equal(revisions.length,2);
  assert.equal(revisions[1].parents[0],revisions[0].revisionId);
});
test('remote update is staged rather than applied without editor permission',async()=>{
  const {name,service,revisions}=fixture();service.enable(name);await service.sync(name);
  const original=local.capture(name);
  db.projectExecute(name,"UPDATE chapters SET content='云端新稿'");
  const remote=local.capture(name,[revisions[0].revisionId]);revisions.push(remote);
  local.restore(name,original,local.capture(name).contentHash);
  const result=await service.sync(name);assert.equal(result.action,'download-ready');
  assert.equal(db.projectGet(name,'SELECT content FROM chapters').content,'初稿');
  await service.apply(name,remote.revisionId,result.expectedHash,'download');
  assert.equal(db.projectGet(name,'SELECT content FROM chapters').content,'云端新稿');
  assert.equal((await service.sync(name)).action,'synced');
});
test('concurrent remote branch conflicts and explicit local resolution preserves history',async()=>{
  const {name,service,revisions}=fixture();service.enable(name);await service.sync(name);
  db.projectExecute(name,"UPDATE chapters SET content='本机新稿'");
  const other=structuredClone(revisions[0]);other.revisionId=randomUUID();other.parents=[revisions[0].revisionId];revisions.push(other);
  const plan=await service.sync(name);assert.equal(plan.action,'conflict');
  await service.resolveLocal(name,plan.expectedHash);
  assert.equal(revisions.length,3);assert.equal((await service.sync(name)).action,'synced');
});
test('import rejects duplicate identity; conflict copy gets independent identity',async()=>{
  const {name,service,revisions}=fixture();service.enable(name);await service.sync(name);
  const copy=`copy-${randomUUID()}`;names.push(copy);
  assert.throws(()=>local.importProject(copy,revisions[0]),/already on this device/);
  const imported=local.importProject(copy,revisions[0],true);
  assert.notEqual(imported.projectId,revisions[0].projectId);
  assert.equal(db.projectGet(copy,'SELECT content FROM chapters').content,'初稿');
});
test('active mutations block replacing local project',async()=>{
  const {name,service,revisions}=fixture();service.enable(name);await service.sync(name);
  service.canApply=()=>false;
  await assert.rejects(service.apply(name,revisions[0].revisionId,local.capture(name).contentHash,'restore'),/still in progress/);
});
test('disconnected account cannot adopt result of an in-flight upload',async()=>{
  const {name,service,store}=fixture();service.enable(name);
  const upload=store.upload;store.upload=async(snapshot)=>{await upload(snapshot);service.isActive=()=>false;};
  await assert.rejects(service.sync(name),/disconnected/);
  assert.equal(service.state.projects[local.capture(name).projectId].revisionId,undefined);
});
test('missing remote after a previous sync is reported and not silently recreated',async()=>{
  const {name,service,revisions}=fixture();service.enable(name);await service.sync(name);revisions.splice(0);
  assert.equal((await service.sync(name)).action,'remote-missing');assert.equal(revisions.length,0);
});
test('sync keeps unresolved fork visible even if one branch has identical content',async()=>{
  const {name,service,revisions}=fixture();service.enable(name);await service.sync(name);
  const a=structuredClone(revisions[0]),b=structuredClone(a);a.revisionId=randomUUID();b.revisionId=randomUUID();a.parents=[revisions[0].revisionId];b.parents=[revisions[0].revisionId];revisions.push(a,b);
  assert.equal((await service.sync(name)).action,'conflict');
});

test('temporary failure backs off and permanent authorization failure stops auto-retry',async()=>{
  for (const retryable of [true,false]) {
    const {name,service,store}=fixture();service.enable(name,true);
    store.listFiles=async()=>{const error=new Error('Injected failure');error.retryable=retryable;throw error;};
    await assert.rejects(service.sync(name),/Injected/);
    assert.equal(service.canAutoSync(name),false);
    assert.equal(service.results.get(name).requiresAction,!retryable);
  }
});
test('cloud discovery displays actual project name rather than internal identity',async()=>{
  const {name,service}=fixture();service.enable(name);await service.sync(name);
  assert.equal((await service.discover())[0].name,name);
});
