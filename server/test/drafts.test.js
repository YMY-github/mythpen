const test=require('node:test'),assert=require('node:assert/strict');
const load=()=>import('../../src/lib/draftQueue.ts');
function storage(){const map=new Map();return {get length(){return map.size;},key:i=>[...map.keys()][i]??null,getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),removeItem:key=>map.delete(key)};}
const draft=(text,project='测试作品',volumeId=1)=>({project,num:1,volumeId,data:{content:text}});
test('late save responses never clear newer typing and concurrent flushes do not duplicate writes',async()=>{
 const {DraftQueue}=await load(),saved=[];let release;const blocked=new Promise(resolve=>release=resolve);
 const queue=new DraftQueue(storage(),async d=>{saved.push(d.data.content);if(saved.length===1)await blocked;});
 queue.put(draft('一'));const saving=queue.flush();const same=queue.flush();queue.put(draft('一字'));release();await Promise.all([saving,same]);
 assert.deepEqual(saved,['一','一字']);assert.equal(queue.pending(),false);
});
test('failed saves keep durable drafts and a new queue restores them after restart',async()=>{
 const {DraftQueue}=await load(),disk=storage();const queue=new DraftQueue(disk,async()=>{throw Error('offline');});queue.put(draft('未保存'));await assert.rejects(queue.flush());assert.ok(queue.pending());
 let restored;const restarted=new DraftQueue(disk,async d=>restored=d);await restarted.flush();assert.equal(restored.data.content,'未保存');assert.equal(restarted.pending(),false);
});
test('single characters, spaces and empty content remain exact and title edits coalesce',async()=>{
 const {DraftQueue}=await load(),written=[];const queue=new DraftQueue(storage(),async d=>written.push(d));
 for(const text of ['字',' ','','\n','中文🙂']){queue.put(draft(text));await queue.flush();assert.equal(written.at(-1).data.content,text);}
 queue.put(draft('正文'));queue.put({...draft(''),data:{title:'新标题'}});await queue.flush();assert.deepEqual(written.at(-1).data,{content:'正文',title:'新标题'});
});
test('outbox keys isolate devices projects and same-number chapters in different volumes',async()=>{
 const {DraftQueue}=await load(),written=[];const queue=new DraftQueue(storage(),async d=>written.push(d));queue.put(draft('卷一','作品A',1));queue.put(draft('卷二','作品A',2));queue.put(draft('另作','作品B',1));
 await queue.flush('作品A');assert.equal(written.length,2);assert.equal(queue.pending('作品A'),false);assert.equal(queue.pending('作品B'),true);
});
