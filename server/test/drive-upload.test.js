const test=require('node:test'),assert=require('node:assert/strict');
const {GoogleDriveStore}=require('../sync/drive');
const session='https://www.googleapis.com/upload/drive/v3/files?upload_id=synthetic';
const start=()=>new Response(null,{headers:{Location:session}});
const progress=last=>new Response(null,{status:308,headers:last===undefined?{}:{Range:`bytes=0-${last}`}});
function store(fetchImpl) {return new GoogleDriveStore({getToken:async()=> 'synthetic-token',fetchImpl});}

test('resumable upload sends aligned chunks and returns completion metadata',async()=>{
 const body=Buffer.alloc(9*1024*1024+7,97),calls=[];
 const drive=store(async(url,options)=>{
  calls.push({url,...options});
  if(options.method==='POST')return start();
  if(calls.length===2)return progress(8*1024*1024-1);
  return Response.json({id:'completed'});
 });
 assert.deepEqual(await drive.uploadResumable({name:'test'},body),{id:'completed'});
 assert.equal(calls.length,3);
 assert.equal(calls[0].headers['X-Upload-Content-Length'],String(body.length));
 assert.equal(calls[1].headers['Content-Range'],`bytes 0-8388607/${body.length}`);
 assert.equal(calls[1].body.length,8*1024*1024);
 assert.equal(calls[2].headers['Content-Range'],`bytes 8388608-${body.length-1}/${body.length}`);
 assert.deepEqual(Buffer.concat([calls[1].body,calls[2].body]),body);
 assert.ok(calls.every(c=>c.headers.Authorization==='Bearer synthetic-token'));
 assert.equal(calls[1].redirect,'manual');
});

test('interrupted response queries server offset and resumes acknowledged bytes only',async()=>{
 const calls=[],body=Buffer.alloc(1024*1024,98);
 const drive=store(async(url,options)=>{
  calls.push(options);
  if(calls.length===1)return start();
  if(calls.length===2)throw new TypeError('fetch failed');
  if(calls.length===3)return progress(262143);
  assert.equal(options.headers['Content-Range'],`bytes 262144-${body.length-1}/${body.length}`);
  assert.deepEqual(options.body,body.subarray(262144));
  return Response.json({id:'resumed'});
 });
 assert.deepEqual(await drive.uploadResumable({},body),{id:'resumed'});
 assert.equal(calls[2].headers['Content-Range'],`bytes */${body.length}`);
 assert.equal(calls[2].headers['Content-Length'],'0');
 assert.equal(calls[2].body,undefined);
});

test('lost final response accepts completed session status without retransmitting',async()=>{
 let calls=0;
 const drive=store(async(_url,options)=>{
  calls++;
  if(calls===1)return start();
  if(calls===2)throw Object.assign(new Error('retry'),{status:503,retryable:true});
  assert.equal(options.headers['Content-Range'],'bytes */3');
  return Response.json({id:'already-complete'});
 });
 assert.equal((await drive.uploadResumable({},Buffer.from('abc'))).id,'already-complete');
 assert.equal(calls,3);
});

test('untrusted or missing resumable locations never receive a token',async()=>{
 for(const location of [null,'https://attacker.example/upload/drive/v3/files','http://www.googleapis.com/upload/drive/v3/files','https://www.googleapis.com/other','https://user@www.googleapis.com/upload/drive/v3/files']){
  let calls=0;
  const drive=store(async()=>{calls++;return new Response(null,{headers:location?{Location:location}:{}});});
  await assert.rejects(drive.uploadResumable({},Buffer.from('abc')),/session identity/);
  assert.equal(calls,1);
 }
});

test('malformed or impossible acknowledged ranges fail safely',async()=>{
 for(const range of ['bytes=1-2','bytes=0-999','bytes=0-9007199254740992']) {
  let calls=0;
  const drive=store(async()=>++calls===1?start():new Response(null,{status:308,headers:{Range:range}}));
  await assert.rejects(drive.uploadResumable({},Buffer.from('abc')),/Invalid resumable upload/);
  assert.equal(calls,2);
 }
});

test('no progress has bounded retries and authorization errors are not retried',async()=>{
 let calls=0;
 const drive=store(async()=>++calls===1?start():progress());
 await assert.rejects(drive.uploadResumable({},Buffer.from('abc')),/no progress/);
 assert.equal(calls,5);
 calls=0;
 const denied=store(async()=>++calls===1?start():Response.json({error:{}},{status:401}));
 await assert.rejects(denied.uploadResumable({},Buffer.from('abc')),e=>e.status===401);
 assert.equal(calls,2);
});
