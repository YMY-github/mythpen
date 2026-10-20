const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mythpen-document-http-'));process.env.MYTHPEN_DATA_DIR=root;
const db=require('../db'),local=require('../sync/local'),{CloudDocuments}=require('../sync/documents'),express=require('express');
const router=require('../routes/sync');let server,url,service;const name='HTTP 自动云文档',revisions=[];
before(async()=>{
 await db.initDatabase();const project=db.getProjectDb(name);project.prepare("INSERT INTO project_meta (key,value) VALUES ('name',?)").run(name);project.prepare("INSERT INTO volumes (id,sort_order,title) VALUES (1,1,'卷一'),(2,2,'卷二')").run();project.prepare("INSERT INTO chapters (volume_id,num,title,content) VALUES (1,1,'一章','本机稿'),(2,1,'另一卷一章','另卷稿')").run();
 const store={listFiles:async()=>revisions.map(r=>({id:r.revisionId,appProperties:{projectId:r.projectId,revisionId:r.revisionId}})),download:async file=>structuredClone(revisions.find(r=>r.revisionId===file.id)),upload:async snapshot=>{revisions.push(structuredClone(snapshot));}};
 service=new CloudDocuments({store,accountId:'synthetic'});await service.sync(name);
 const original=local.capture(name);db.projectExecute(name,"UPDATE chapters SET content='云端稿' WHERE volume_id=1");revisions.push(local.capture(name,[revisions[0].revisionId]));local.restore(name,original,local.capture(name).contentHash);
 router.runtime.status=async()=>({phase:'connected'});router.runtime.activate=async()=>service;
 const app=express();app.use(express.json());app.use('/api/sync',router);app.use('/api',require('../routes/api'));
 server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));url=`http://127.0.0.1:${server.address().port}/api`;
});
after(async()=>{await new Promise(resolve=>server.close(resolve));db.closeProjectDb(db.getProjectDbPath(name));db.getConfigDb().close();fs.rmSync(root,{recursive:true,force:true});});
test('an HTTP request cancelled during cloud reads never replaces local work later',async()=>{
 let release,entered;const barrier=new Promise(resolve=>release=resolve),reading=new Promise(resolve=>entered=resolve);const original=service.store.listFiles;
 service.store.listFiles=async()=>{entered();await barrier;return original();};
 let closed;const socketClosed=new Promise(resolve=>closed=resolve);server.once('request',(_req,res)=>res.once('close',closed));
 const controller=new AbortController();const request=fetch(`${url}/sync/documents/open`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name}),signal:controller.signal});
 await reading;controller.abort();await assert.rejects(request);await socketClosed;release();
 // Wait for the queued operation to reject its final apply guard.
 while(service.running.size)await Promise.allSettled([...service.running.values()]);
 assert.equal(db.projectGet(name,'SELECT content FROM chapters WHERE volume_id=1').content,'本机稿');service.store.listFiles=original;
});
test('same-number chapters in another volume are not overwritten by autosave',async()=>{
 const response=await fetch(`${url}/${encodeURIComponent(name)}/chapters/1`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({volume_id:2,content:'只改第二卷'})});
 assert.equal(response.status,200);assert.equal((await response.json()).volume_id,2);
 assert.equal(db.projectGet(name,'SELECT content FROM chapters WHERE volume_id=1').content,'本机稿');assert.equal(db.projectGet(name,'SELECT content FROM chapters WHERE volume_id=2').content,'只改第二卷');
});
test('without Google configuration opening remains local and does not block writing',async()=>{
 router.runtime.status=async()=>({phase:'disconnected'});
 const response=await fetch(`${url}/sync/documents/open`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});assert.deepEqual(await response.json(),{action:'local'});
});
