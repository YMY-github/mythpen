const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
for(const native of [false,true])test(`cover, export and health use the correct ${native?'desktop':'browser'} origin`,()=>{
 const module=pathToFileURL(path.resolve(__dirname,'../../src/lib/api.ts')).href;
 const script=`globalThis.window=${native?'{__TAURI_INTERNALS__:{}}':'{}'};const {apiUrl,projectsApi}=await import(${JSON.stringify(module)});console.log(JSON.stringify([apiUrl('/health'),projectsApi.getCoverUrl('中文 稿件'),apiUrl('/中文/export?format=epub&download=1'),apiUrl('//stats')]));`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
 const base=native?'http://127.0.0.1:3101/api':'/api';
 assert.deepEqual(JSON.parse(result.stdout),[base+'/health',base+'/%E4%B8%AD%E6%96%87%20%E7%A8%BF%E4%BB%B6/cover',base+'/中文/export?format=epub&download=1',base+'/stats']);
});
