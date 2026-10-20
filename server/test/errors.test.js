const test=require('node:test'),assert=require('node:assert/strict');
const {retryable,publicError}=require('../sync/errors');
const {GoogleDriveStore}=require('../sync/drive');
test('permanent format and local storage failures stop automatic retries',()=>{
 assert.equal(retryable(new Error('Snapshot checksum mismatch')),false);
 const disk=Object.assign(new Error('ENOSPC /private/user-manuscript.db'),{code:'ENOSPC'});
 assert.equal(retryable(disk),false);assert.equal(publicError(disk).code,'disk-space');
 assert.ok(!JSON.stringify(publicError(disk)).includes('user-manuscript'));
 assert.equal(retryable(new TypeError('fetch failed')),true);
 assert.equal(retryable(Object.assign(new Error('injected'),{retryable:false})),false);
});
test('Drive quota and rate limiting have distinct recovery categories',async()=>{
 for(const reason of ['storageQuotaExceeded','userRateLimitExceeded']){
  const store=new GoogleDriveStore({getToken:async()=> 'synthetic',fetchImpl:async()=>Response.json({error:{message:'private response data',errors:[{reason}]}},{status:403})});
  await assert.rejects(store.listFiles(),error=>{
   assert.equal(retryable(error),reason==='userRateLimitExceeded');
   assert.equal(publicError(error).code,reason==='storageQuotaExceeded'?'quota':'network');
   assert.ok(!JSON.stringify(publicError(error)).includes('private response data'));return true;
  });
 }
});
