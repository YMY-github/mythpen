const router = require('express').Router();
const local = require('../sync/local');
const {SyncRuntime}=require('../sync/runtime');
const {publicError}=require('../sync/errors');
const runtime=new SyncRuntime();
const wrap=fn=>async(req,res,next)=>{try{res.json(await fn(req,res));}catch(error){next(error);}};
router.use((req,res,next)=> {
  if(req.method!=='GET' && !req.is('application/json')) return res.status(415).json({error:{message:'JSON request required'}});
  next();
});
router.get('/status',wrap(()=>runtime.status()));
router.get('/diagnostics',wrap(()=>runtime.diagnostics()));
router.post('/wake',wrap(async()=> {await runtime.wake();return {checked:true};}));
router.post('/configure',wrap(req=>runtime.configure(req.body)));
router.post('/connect',wrap(()=>runtime.connect()));
router.post('/disconnect',wrap(()=>runtime.disconnect()));
// An aborted/open-timeout request may finish its network reads, but must never
// replace local data after the frontend has resumed offline editing.
const live=res=>()=>!res.destroyed && !res.writableEnded;
async function documentService(){const status=await runtime.status();return status.phase==='connected' ? runtime.activate() : null;}
router.post('/documents/catalog',wrap(async(req,res)=>{const service=await documentService();return service ? service.catalog(live(res)) : {imported:0,local:true};}));
router.post('/documents/open',wrap(async(req,res)=>{const service=await documentService();return service ? service.open(req.body.name,live(res)) : {action:'local'};}));
router.post('/documents/check',wrap(async req=>{const service=await documentService();return service ? service.automaticCheck(req.body.name) : {action:'local'};}));
router.post('/documents/apply',wrap(async(req,res)=>{const service=await documentService();if(!service)throw new Error('Connect Google first');return service.applyLatest(req.body.name,req.body.expectedHash,live(res));}));
router.get('/cloud-projects',wrap(async()=> (await runtime.activate()).discover()));
router.post('/import',wrap(async req=> (await runtime.activate()).import(req.body.projectId,req.body.revisionId,req.body.name)));
router.get('/projects/:name/status',wrap(async req=> (await runtime.activate()).status(req.params.name)));
router.post('/projects/:name/enable',wrap(async req=> (await runtime.activate()).enable(req.params.name,req.body.auto)));
router.post('/projects/:name/disable',wrap(async req=> (await runtime.activate()).disable(req.params.name)));
router.post('/projects/:name/sync',wrap(async req=> (await runtime.activate()).sync(req.params.name)));
router.get('/projects/:name/history',wrap(async req=> (await runtime.activate()).history(req.params.name)));
router.post('/projects/:name/retention/preview',wrap(async req=> (await runtime.activate()).previewRetention(req.params.name,req.body.keep)));
router.post('/projects/:name/retention/clean',wrap(async req=> (await runtime.activate()).cleanHistory(req.params.name,req.body.keep,req.body.token,req.body.confirmed)));
router.post('/projects/:name/apply',wrap(async req=> (await runtime.activate()).apply(req.params.name,req.body.revisionId,req.body.expectedHash,req.body.choice)));
router.post('/projects/:name/resolve-local',wrap(async req=> (await runtime.activate()).resolveLocal(req.params.name,req.body.expectedHash)));
router.get('/projects/:name/backups',wrap(req=>local.listBackups(req.params.name)));
router.get('/projects/:name/local-status',wrap(req=>({currentHash:local.capture(req.params.name).contentHash})));
router.post('/projects/:name/backups/:revisionId/restore',wrap(req=>{
  if(runtime.canApply?.()===false || runtime.service?.running.has(req.params.name)) throw new Error('Writing or sync is still in progress');
  return local.restoreBackup(req.params.name,req.params.revisionId,req.body.expectedHash);
}));
router.post('/projects/:name/backups',wrap(req=> {
  const snapshot=local.capture(req.params.name);local.saveBackup(snapshot);
  return {revisionId:snapshot.revisionId,createdAt:snapshot.createdAt};
}));
router.use((error,req,res,next)=>res.status(400).json({error:publicError(error)}));
router.runtime=runtime;
module.exports=router;
