const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mythpen-runtime-test-'));
process.env.MYTHPEN_DATA_DIR=directory;
const {SyncRuntime}=require('../sync/runtime');
function runtime(){
 const r=new SyncRuntime();r.config=()=>({client_id:'synthetic.apps.googleusercontent.com'});
 r.initialize=()=>{};r.vault={get:async()=>({access_token:'synthetic',refresh_token:'synthetic',accountId:'synthetic-account'})};
 return r;
}
test.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
test('successful credential recovery clears an old cancellation message',async()=>{
 const r=runtime();r.message='Previous credential read cancelled';
 const status=await r.status();assert.equal(status.phase,'connected');assert.equal(status.message,'');
});
test('focus and reconnect checks are throttled, and connecting accounts are not interrupted',async()=>{
 const r=runtime();let checks=0;r.activate=async()=>({tick:async()=>{checks++}});
 await Promise.all([r.wake(),r.wake(),r.wake()]);assert.equal(checks,1);
 r.lastWake=Date.now()-31000;await r.wake();assert.equal(checks,2);
 r.phase='connecting';r.lastWake=0;await r.wake();assert.equal(checks,2);
});
test('diagnostics omit account names, tokens, project names and filesystem paths',()=>{
 const r=runtime();r.account='private-account@example.test';
 r.config=()=>({client_id:'private-client-id',client_secret:'private-client-secret'});
 r.service={state:{projects:{x:{name:'private-manuscript',enabled:true,auto:true}}},results:new Map([['private-manuscript',{action:'error',message:'/private/user/secret.db'}]])};
 const diagnostics=r.diagnostics(),text=JSON.stringify(diagnostics);
 assert.equal(diagnostics.enabledProjects,1);assert.equal(diagnostics.resultCounts.error,1);
 for(const forbidden of ['private-account','private-client','private-manuscript','/private/user'])assert.ok(!text.includes(forbidden));
});
test('pending authorization can be reopened from status, and cancellation removes its URL',async()=>{
 const r=runtime();r.vault.get=async()=>null;
 const url='https://accounts.google.com/o/oauth2/v2/auth?state=synthetic';
 let reject;
 const result=new Promise((resolve,no)=>{reject=no;});
 r.oauth={begin:async()=>({url,result}),disconnect:async()=>{reject(new Error('Authorization cancelled'));}};
 assert.equal((await r.connect()).url,url);
 const status=await r.status();assert.equal(status.phase,'connecting');assert.equal(status.authorizationUrl,url);
 assert.ok(!JSON.stringify(r.diagnostics()).includes('state=synthetic'));
 r.activate=async()=>{throw new Error('Connect Google first');};
 const disconnected=await r.disconnect();assert.equal(disconnected.phase,'disconnected');assert.equal(disconnected.authorizationUrl,null);
});
test('failed authorization expires the pending URL instead of leaving a dead login link',async()=>{
 const r=runtime();r.vault.get=async()=>null;
 let reject;const result=new Promise((resolve,no)=>{reject=no;});
 r.oauth={begin:async()=>({url:'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic',result}),disconnect:async()=>{}};
 await r.connect();reject(new Error('Authorization timed out'));
 await new Promise(resolve=>setImmediate(resolve));
 r.activate=async()=>{throw new Error('Connect Google first');};
 const status=await r.status();assert.equal(status.phase,'disconnected');assert.equal(status.authorizationUrl,null);
});
