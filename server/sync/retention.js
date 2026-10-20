const {graphHeads,hash}=require('./snapshot');

function planRetention({revisions,keep=30,baselineId,currentHash,now=Date.now()}) {
  if(!Number.isSafeInteger(keep) || keep<2 || keep>1000) throw new Error('Keep between 2 and 1000 versions');
  const byId=new Map();
  for(const revision of revisions) {
    if(byId.has(revision.revisionId) && byId.get(revision.revisionId).fingerprint!==revision.fingerprint) throw new Error('Revision identity collision');
    byId.set(revision.revisionId,revision);
  }
  const unique=[...byId.values()],heads=graphHeads(unique);
  const protectedIds=new Set([baselineId,...heads.map(r=>r.revisionId)].filter(Boolean));
  for(const revision of unique) if(revision.contentHash===currentHash) protectedIds.add(revision.revisionId);
  unique.sort((a,b)=>b.createdAt.localeCompare(a.createdAt) || a.revisionId.localeCompare(b.revisionId));
  for(const revision of unique.slice(0,keep)) protectedIds.add(revision.revisionId);
  // Never prune an unresolved fork, or a recently-created revision that may
  // still be used by another device. Snapshots are independently restorable.
  const candidates=heads.length===1 ? revisions.filter(r=>!protectedIds.has(r.revisionId) && Date.parse(r.createdAt)<now-86400000) : [];
  const fileIds=candidates.map(r=>r.fileId).sort();
  const inventory=revisions.map(r=>[r.fileId,r.revisionId,r.fingerprint]).sort((a,b)=>a[0].localeCompare(b[0]));
  const token=hash(JSON.stringify({keep,baselineId,currentHash,inventory,fileIds}));
  return {keep,total:unique.length,removeCount:candidates.length,conflict:heads.length>1,bytes:candidates.reduce((n,r)=>n+r.bytes,0),token,fileIds,
    versions:candidates.map(r=>({fileId:r.fileId,createdAt:r.createdAt,revisionId:r.revisionId,bytes:r.bytes}))};
}
module.exports={planRetention};
