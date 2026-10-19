const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mythpen-sync-test-'));
process.env.MYTHPEN_DATA_DIR = root;
const db = require('../db');
const local = require('../sync/local');
const { validateSnapshot, decideSync, findHeads } = require('../sync/snapshot');
const { GoogleDriveStore } = require('../sync/drive');
const name = '中文 测试作品';
let base;
before(async () => {
  await db.initDatabase();
  const project = db.getProjectDb(name);
  project.prepare("INSERT OR REPLACE INTO project_meta (key,value) VALUES ('name',?)").run(name);
  project.prepare("INSERT INTO volumes (id,sort_order,title) VALUES (1,1,'第一卷')").run();
  project.prepare("INSERT INTO chapters (volume_id,num,title,content) VALUES (1,1,'初见','第一段正文')").run();
  fs.mkdirSync(db.getCoverDir(name), { recursive: true });
  fs.writeFileSync(path.join(db.getCoverDir(name),'cover.png'), Buffer.from('test-cover'));
  base = local.capture(name);
});
after(() => {
  db.closeProjectDb(db.getProjectDbPath(name)); db.getConfigDb().close();
  fs.rmSync(root, { recursive: true, force: true });
});
test('capture contains live writes and cover, excluding config secrets', () => {
  db.dbExecute("INSERT OR REPLACE INTO app_settings (key,value) VALUES ('api_key','NEVER_UPLOAD')");
  const snapshot = local.capture(name);
  assert.equal(snapshot.projectId, base.projectId);
  const files = validateSnapshot(snapshot);
  assert.equal(files.size, 2);
  assert.equal(files.get('cover.png').toString(), 'test-cover');
  assert.equal(files.get('project.db').includes(Buffer.from('第一段正文')), true);
  assert.equal(files.get('project.db').includes(Buffer.from('NEVER_UPLOAD')), false);
});
test('snapshot rejects corruption, traversal, duplicate files and future schemas', () => {
  const copy = () => structuredClone(base);
  let bad = copy(); bad.files[0].data = Buffer.from('corrupt').toString('base64');
  assert.throws(() => validateSnapshot(bad));
  bad = copy(); bad.files[0].name = '../config.db'; assert.throws(() => validateSnapshot(bad));
  bad = copy(); bad.files = [bad.files[0],bad.files[0]]; assert.throws(() => validateSnapshot(bad));
  bad = copy(); bad.schemaVersion = 999; assert.throws(() => validateSnapshot(bad));
});
test('project names cannot escape storage or use Windows reserved paths', () => {
  for (const value of ['../x','a/b','a\\b','CON','NUL.txt','x.','x ','']) assert.throws(() => db.getProjectDbPath(value));
  assert.ok(db.getProjectDbPath(name).startsWith(root));
});
test('empty remote with previous baseline never silently re-uploads', () => {
  assert.equal(decideSync({localHash:base.contentHash,revisions:[]}).action,'upload');
  assert.equal(decideSync({localHash:base.contentHash,baseRevision:base.revisionId,revisions:[]}).action,'remote-missing');
});
test('unchanged content does not need upload', () => {
  assert.equal(decideSync({localHash:base.contentHash,revisions:[base]}).action,'unchanged');
});
test('descendant pulls only if local is unchanged; unrelated revision conflicts', () => {
  const remote = structuredClone(base); remote.revisionId = randomUUID(); remote.parents = [base.revisionId];
  // Make genuine different content via live SQL, preserving a valid snapshot.
  db.projectExecute(name,"UPDATE chapters SET content = '第二段正文'");
  const changed = local.capture(name,[base.revisionId]);
  const input = { localHash:base.contentHash, baseHash:base.contentHash, baseRevision:base.revisionId, revisions:[base,changed] };
  assert.equal(decideSync(input).action,'download');
  assert.equal(decideSync({...input,localHash:'local-change'}).action,'conflict');
  changed.parents = []; assert.equal(decideSync({...input,revisions:[changed]}).action,'conflict');
});
test('two concurrent uploads remain visible as a conflict regardless of time', () => {
  const a = structuredClone(base); a.revisionId = randomUUID(); a.parents = [base.revisionId];
  const b = structuredClone(base); b.revisionId = randomUUID(); b.parents = [base.revisionId]; b.createdAt='2099-01-01';
  assert.equal(findHeads([base,a,b]).length,2);
  assert.equal(decideSync({localHash:base.contentHash,revisions:[base,a,b]}).action,'conflict');
});
test('revision collision and mixed project lists are rejected', () => {
  const duplicate = structuredClone(base); duplicate.createdAt='different';
  assert.throws(() => findHeads([base,duplicate]));
  duplicate.revisionId=randomUUID(); duplicate.projectId=randomUUID();
  assert.throws(() => findHeads([base,duplicate]));
});
test('stale restore guard preserves newer local text', () => {
  assert.throws(() => local.restore(name,base,'outdated-hash'), /Local project changed/);
  assert.equal(db.projectGet(name,'SELECT content FROM chapters').content,'第二段正文');
});
test('restore preserves current revision and recovers both database and cover', () => {
  const before = local.capture(name);
  const restored = local.restore(name,base,before.contentHash);
  assert.equal(restored.contentHash,base.contentHash);
  assert.equal(db.projectGet(name,'SELECT content FROM chapters').content,'第一段正文');
  assert.equal(local.listBackups(name).length,1);
  assert.equal(local.recoverPending(),false);
});
test('pending journal is replayed before further editing', () => {
  db.projectExecute(name,"UPDATE chapters SET content = '待恢复'");
  const directory = path.join(root,'sync-recovery');
  fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'pending.json'),JSON.stringify({name,snapshot:base}));
  assert.equal(local.recoverPending(),true);
  assert.equal(db.projectGet(name,'SELECT content FROM chapters').content,'第一段正文');
});
test('Drive pagination uses only appDataFolder and keeps credentials out of URLs', async () => {
  const urls=[];
  const store = new GoogleDriveStore({getToken:async()=> 'private-token',fetchImpl:async(url,options)=> {
    urls.push(url); assert.equal(options.headers.Authorization,'Bearer private-token');
    return Response.json(urls.length === 1 ? {files:[{id:'a'}],nextPageToken:'next'} : {files:[{id:'b'}]});
  }});
  assert.equal((await store.listFiles(base.projectId)).length,2);
  assert.ok(urls.every(url => url.includes('spaces=appDataFolder') && !url.includes('private-token')));
});
test('Drive failures distinguish retriable and authorization errors', async () => {
  for (const status of [401,429,503]) {
    const store = new GoogleDriveStore({getToken:async()=> 'test',fetchImpl:async()=>new Response('',{status})});
    await assert.rejects(store.listFiles(), error=>error.status===status && error.retryable===(status!==401));
  }
});
test('Drive download validates identity and file contents', async () => {
  const store=new GoogleDriveStore({getToken:async()=> 'test',fetchImpl:async()=>Response.json(base)});
  const file={id:'file_id',appProperties:{projectId:base.projectId,revisionId:base.revisionId}};
  assert.equal((await store.download(file)).contentHash,base.contentHash);
  await assert.rejects(store.download({...file,appProperties:{projectId:randomUUID()}}),/identity mismatch/);
});

test('cyclic remote graph is rejected rather than mistaken for empty storage', () => {
  const a = structuredClone(base), b = structuredClone(base);
  b.revisionId = randomUUID(); a.parents = [b.revisionId]; b.parents = [a.revisionId];
  assert.throws(() => findHeads([a,b]), /revision graph/);
});
