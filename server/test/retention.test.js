const test=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {planRetention}=require('../sync/retention');
const {graphHeads}=require('../sync/snapshot');
function chain(count){
 const projectId=randomUUID(),rows=[];
 for(let i=0;i<count;i++)rows.push({projectId,revisionId:randomUUID(),parents:i?[rows[i-1].revisionId]:[],createdAt:new Date(Date.UTC(2020,0,1+i)).toISOString(),contentHash:`hash-${i}`,fingerprint:`snapshot-${i}`,fileId:`file-${i}`,bytes:100});
 return rows;
}
test('cleanup keeps newest count, current local content and the device baseline',()=>{
 const revisions=chain(40),plan=planRetention({revisions,keep:30,baselineId:revisions[2].revisionId,currentHash:revisions[3].contentHash});
 assert.equal(plan.removeCount,8);assert.equal(plan.bytes,800);
 assert.ok(!plan.fileIds.includes('file-2'));assert.ok(!plan.fileIds.includes('file-3'));assert.ok(!plan.fileIds.includes('file-39'));
});
test('unresolved forks protect every revision, even outside the retention count',()=>{
 const revisions=chain(40);revisions.push({...revisions[39],revisionId:randomUUID(),fingerprint:'other',fileId:'other'});
 const plan=planRetention({revisions,keep:2});assert.equal(plan.conflict,true);assert.equal(plan.removeCount,0);
});
test('new uploads invalidate a preview, and recent files remain protected',()=>{
 const revisions=chain(10),plan=planRetention({revisions,keep:2});
 const recent={...revisions[0],revisionId:randomUUID(),fileId:'recent',fingerprint:'recent',createdAt:new Date().toISOString()};
 revisions.push(recent);
 const next=planRetention({revisions,keep:2});assert.notEqual(next.token,plan.token);assert.ok(!next.fileIds.includes('recent'));
});
test('physical duplicates are handled without treating them as conflicting revisions',()=>{
 const revisions=chain(5);revisions.push({...revisions[0],fileId:'duplicate'});
 const plan=planRetention({revisions,keep:2});assert.equal(plan.total,5);assert.equal(plan.removeCount,4);
 revisions.push({...revisions[0],fileId:'bad',fingerprint:'different'});
 assert.throws(()=>planRetention({revisions}),/collision/);
});
test('long histories do not overflow a recursive graph walk and cycles are rejected',()=>{
 const revisions=chain(1500);assert.equal(graphHeads(revisions)[0].revisionId,revisions[1499].revisionId);
 revisions[0].parents=[revisions[1499].revisionId];assert.throws(()=>graphHeads(revisions),/graph/);
 assert.throws(()=>planRetention({revisions:[],keep:0}),/between/);
});
