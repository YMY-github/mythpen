const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mythpen-cloud-doc-'));process.env.MYTHPEN_DATA_DIR=root;
const db=require('../db'),local=require('../sync/local'),{CloudDocuments}=require('../sync/documents'),{hash}=require('../sync/snapshot');
const names=[];before(()=>db.initDatabase());after(()=>{for(const name of names)db.closeProjectDb(db.getProjectDbPath(name));db.getConfigDb().close();fs.rmSync(root,{recursive:true,force:true});});
function fixture(content='') {
 const name=`自动文档-${randomUUID().slice(0,8)}`;names.push(name);const project=db.getProjectDb(name);
 project.prepare("INSERT INTO project_meta (key,value) VALUES ('name',?)").run(name);
 project.prepare("INSERT INTO volumes (id,sort_order,title) VALUES (1,1,'卷')").run();
 project.prepare("INSERT INTO chapters (volume_id,num,title,content) VALUES (1,1,'章',?)").run(content);
 db.dbExecute('INSERT INTO recent_projects (id,name,file_path,last_opened,word_count) VALUES (?,?,?,?,?)',[name,name,db.getProjectDbPath(name),new Date().toISOString(),0]);
 const revisions=[],metadata=new Map();let downloads=0,clock=0;
 const store={listFiles:async id=>revisions.filter(r=>!id||r.projectId===id).map(r=>({id:r.revisionId,version:'1',md5Checksum:hash(JSON.stringify(r)),createdTime:new Date(1700000000000+metadata.get(r.revisionId)).toISOString(),appProperties:{projectId:r.projectId,revisionId:r.revisionId}})),
 download:async file=>{downloads++;return structuredClone(revisions.find(r=>r.revisionId===file.id));},
 upload:async snapshot=>{revisions.push(structuredClone(snapshot));metadata.set(snapshot.revisionId,++clock);}};
 const service=new CloudDocuments({store,accountId:randomUUID()});
 return {name,service,store,revisions,get downloads(){return downloads;}};
}
function edit(name,text){db.projectExecute(name,'UPDATE chapters SET content=? WHERE num=1',[text]);}
async function remoteEdit(f,text){const current=local.capture(f.name),parent=f.revisions.at(-1).revisionId;edit(f.name,text);const remote=local.capture(f.name,[parent]);await f.store.upload(remote);local.restore(f.name,current,local.capture(f.name).contentHash);return remote;}
test('a single character, a blank and deletion all upload without manual enable',async()=>{
 const f=fixture();assert.equal((await f.service.sync(f.name)).action,'uploaded');
 for(const text of ['字','字 ','']){edit(f.name,text);assert.equal((await f.service.sync(f.name)).action,'uploaded');}
 assert.equal(f.revisions.length,4);assert.equal((await f.service.sync(f.name)).action,'synced');assert.equal(f.revisions.length,4);
 assert.equal(f.service.status(f.name).auto,true);
});
test('opening another device automatically downloads the latest cloud manuscript',async()=>{
 const f=fixture('本机初稿');await f.service.sync(f.name);await remoteEdit(f,'云端新稿');
 assert.equal((await f.service.open(f.name)).action,'applied');
 assert.equal(db.projectGet(f.name,'SELECT content FROM chapters').content,'云端新稿');
 assert.equal((await f.service.sync(f.name)).action,'synced');
});
test('cloud wins an offline divergence and local edits are first retained as a recovery copy',async()=>{
 const f=fixture('共同初稿');await f.service.sync(f.name);await remoteEdit(f,'Windows 云稿');edit(f.name,'Mac 离线稿');
 const before=local.capture(f.name);assert.equal((await f.service.open(f.name)).action,'applied');
 assert.equal(db.projectGet(f.name,'SELECT content FROM chapters').content,'Windows 云稿');
 const backups=local.listBackups(f.name);assert.ok(backups.some(b=>local.readSnapshot(path.join(root,'backups',before.projectId,`${b.revisionId}.json`)).contentHash===before.contentHash));
 assert.equal((await f.service.sync(f.name)).action,'synced');
});
test('old unresolved forks are automatically resolved using Drive time, not device clock',async()=>{
 const f=fixture('初稿');await f.service.sync(f.name);const base=local.capture(f.name);
 edit(f.name,'过时设备的稿');const first=local.capture(f.name,[f.revisions[0].revisionId]);first.createdAt='2099-01-01T00:00:00.000Z';await f.store.upload(first);
 edit(f.name,'云端后上传的新稿');const second=local.capture(f.name,[f.revisions[0].revisionId]);second.createdAt='2000-01-01T00:00:00.000Z';await f.store.upload(second);
 local.restore(f.name,base,local.capture(f.name).contentHash);await f.service.open(f.name);
 assert.equal(db.projectGet(f.name,'SELECT content FROM chapters').content,'云端后上传的新稿');
 edit(f.name,'继续写一字');await f.service.sync(f.name);assert.ok(f.revisions.at(-1).parents.includes(first.revisionId));assert.ok(f.revisions.at(-1).parents.includes(second.revisionId));
});
test('cancelled requests and changed local hashes cannot apply a cloud download',async()=>{
 const f=fixture('初稿');await f.service.sync(f.name);await remoteEdit(f,'云端稿');const expected=local.capture(f.name).contentHash;
 await assert.rejects(f.service.applyLatest(f.name,expected,()=>false),/request changed/);
 edit(f.name,'取消后继续写');await assert.rejects(f.service.applyLatest(f.name,expected),/Local project changed/);
 assert.equal(db.projectGet(f.name,'SELECT content FROM chapters').content,'取消后继续写');
});
test('writing and AI mutations block automatic cloud replacement',async()=>{
 const f=fixture('初稿');await f.service.sync(f.name);await remoteEdit(f,'云端稿');f.service.canApply=()=>false;
 await assert.rejects(f.service.open(f.name),/Writing/);assert.equal(db.projectGet(f.name,'SELECT content FROM chapters').content,'初稿');
});
test('edits during upload stay pending and are sent on the next automatic check',async()=>{
 const f=fixture('初稿'),upload=f.store.upload;f.store.upload=async snapshot=>{await upload(snapshot);edit(f.name,'上传过程中新增');};
 assert.equal((await f.service.sync(f.name)).pending,true);f.store.upload=upload;
 assert.equal((await f.service.sync(f.name)).action,'uploaded');assert.equal(f.revisions.length,2);
});
test('offline failures preserve unsent local work and restart recovers its pending state',async()=>{
 const f=fixture('初稿');await f.service.sync(f.name);edit(f.name,'离线字');const list=f.store.listFiles;f.store.listFiles=async()=>{throw new TypeError('fetch failed');};
 await assert.rejects(f.service.sync(f.name));assert.equal(f.service.status(f.name).pending,true);
 f.store.listFiles=list;const restarted=new CloudDocuments({store:f.store,accountId:f.service.accountId});
 assert.equal(restarted.status(f.name).pending,true);assert.equal((await restarted.sync(f.name)).action,'uploaded');
});
test('automatic catalog imports cloud projects and keeps same-name identities separate',async()=>{
 const f=fixture('云文档');const remote=local.capture(f.name);await f.store.upload(remote);
 db.closeProjectDb(db.getProjectDbPath(f.name));fs.unlinkSync(db.getProjectDbPath(f.name));db.dbExecute('DELETE FROM recent_projects WHERE name=?',[f.name]);
 const other=db.getProjectDb(f.name);other.prepare("INSERT INTO project_meta (key,value) VALUES ('name',?)").run(f.name);local.capture(f.name);
 db.dbExecute('INSERT INTO recent_projects (id,name,file_path,last_opened,word_count) VALUES (?,?,?,?,?)',[f.name,f.name,db.getProjectDbPath(f.name),new Date().toISOString(),0]);
 assert.equal((await f.service.catalog()).imported,1);const imported=db.dbQuery('SELECT name FROM recent_projects').find(p=>p.name.startsWith(`${f.name} (`));assert.ok(imported);names.push(imported.name);
 assert.equal(db.projectGet(imported.name,'SELECT content FROM chapters').content,'云文档');assert.equal((await f.service.catalog()).imported,0);
});
test('unchanged verified history is cached, while body changes invalidate the cache',async()=>{
 const f=fixture('初稿');await f.service.sync(f.name);const count=f.downloads;
 await f.service.sync(f.name);assert.equal(f.downloads,count);
 f.revisions[0].createdAt='2001-01-01T00:00:00.000Z';await f.service.revisions(f.revisions[0].projectId);assert.ok(f.downloads>count);
});
test('a missing cloud document is reported without silently recreating old local content',async()=>{
 const f=fixture('稿');await f.service.sync(f.name);f.revisions.splice(0);assert.equal((await f.service.sync(f.name)).action,'remote-missing');assert.equal(f.revisions.length,0);
});
test('a saved one-character edit triggers the runtime uploader without manual sync',async()=>{
 const f=fixture('初稿'),{SyncRuntime}=require('../sync/runtime'),runtime=new SyncRuntime();runtime.service=f.service;runtime.activate=async()=>f.service;
 runtime.start();try{edit(f.name,'初稿字');await new Promise(resolve=>setTimeout(resolve,900));assert.equal(f.revisions.length,1);assert.equal(f.service.status(f.name).pending,false);}finally{runtime.stop();}
});
