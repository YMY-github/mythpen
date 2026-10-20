// Community cloud-sync extension. Immutable, project-only snapshots.
const { randomUUID, createHash } = require('node:crypto');
const MAX_BYTES = 64 * 1024 * 1024;
const hash = data => createHash('sha256').update(data).digest('hex');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const allowed = name => name === 'project.db' || /^cover\.(png|jpg|webp|gif)$/.test(name);

function contentHash(files) {
  return hash(JSON.stringify(files.map(f => [f.name, f.size, f.sha256]).sort((a,b) => a[0].localeCompare(b[0]))));
}

function createSnapshot({ projectId, deviceId, parents = [], database, cover }) {
  if (!uuid(projectId) || !uuid(deviceId) || !parents.every(uuid)) throw new Error('Invalid identity');
  const entries = [{ name: 'project.db', bytes: database }];
  if (cover) entries.push(cover);
  const files = entries.map(({ name, bytes }) => ({ name, size: bytes.length, sha256: hash(bytes), data: Buffer.from(bytes).toString('base64') }));
  const snapshot = { formatVersion: 1, schemaVersion: 2, projectId, deviceId, revisionId: randomUUID(), parents, createdAt: new Date().toISOString(), files, contentHash: contentHash(files) };
  validateSnapshot(snapshot);
  return snapshot;
}

function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.formatVersion !== 1 || snapshot.schemaVersion !== 2) throw new Error('Unsupported snapshot version');
  if (![snapshot.projectId, snapshot.deviceId, snapshot.revisionId].every(uuid)) throw new Error('Invalid identity');
  if (typeof snapshot.createdAt!=='string' || snapshot.createdAt.length>40 || !Number.isFinite(Date.parse(snapshot.createdAt))) throw new Error('Invalid revision date');
  if (!Array.isArray(snapshot.parents) || snapshot.parents.length > 16 || !snapshot.parents.every(uuid) || new Set(snapshot.parents).size!==snapshot.parents.length || snapshot.parents.includes(snapshot.revisionId)) throw new Error('Invalid parents');
  if (!Array.isArray(snapshot.files) || snapshot.files.length < 1 || snapshot.files.length > 2) throw new Error('Invalid files');
  const decoded = new Map();
  let total = 0;
  for (const file of snapshot.files) {
    if (!file || !allowed(file.name) || decoded.has(file.name)) throw new Error('Invalid file path');
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_BYTES) throw new Error('Invalid file size');
    if (typeof file.data !== 'string' || file.data.length > Math.ceil(MAX_BYTES / 3) * 4) throw new Error('Invalid data');
    const bytes = Buffer.from(file.data, 'base64');
    if (bytes.toString('base64') !== file.data || bytes.length !== file.size || hash(bytes) !== file.sha256) throw new Error('Snapshot checksum mismatch');
    total += bytes.length;
    if (total > MAX_BYTES) throw new Error('Snapshot too large');
    decoded.set(file.name, bytes);
  }
  const database = decoded.get('project.db');
  if (!database || database.subarray(0, 16).toString() !== 'SQLite format 3\u0000') throw new Error('Invalid database');
  if (snapshot.contentHash !== contentHash(snapshot.files)) throw new Error('Snapshot content mismatch');
  return decoded;
}

// All successful uploads remain discoverable; no mutable latest pointer is trusted.
function findHeads(revisions) {
  for (const revision of revisions) validateSnapshot(revision);
  return graphHeads(revisions);
}

// Descriptors have already been validated on download. An iterative walk also
// supports long-lived projects without a recursive stack/depth limit.
function graphHeads(revisions) {
  if (!Array.isArray(revisions) || revisions.length>10000) throw new Error('Too many revisions');
  const byId = new Map();
  for (const revision of revisions) {
    if (!uuid(revision.projectId) || !uuid(revision.revisionId) || !Array.isArray(revision.parents) || revision.parents.length>16 || !revision.parents.every(uuid)) throw new Error('Invalid revision graph');
    const previous = byId.get(revision.revisionId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(revision)) throw new Error('Revision identity collision');
    byId.set(revision.revisionId, revision);
  }
  if (new Set(revisions.map(r => r.projectId)).size > 1) throw new Error('Mixed projects');
  const visiting = new Set(), visited = new Set();
  for (const root of byId.keys()) {
    const pending=[[root,false]];
    while(pending.length) {
      const [id,done]=pending.pop();
      if(done) {visiting.delete(id);visited.add(id);continue;}
      if(visited.has(id) || !byId.has(id)) continue;
      if(visiting.has(id)) throw new Error('Invalid revision graph');
      visiting.add(id);pending.push([id,true]);
      for(const parent of byId.get(id).parents) pending.push([parent,false]);
    }
  }
  const referenced = new Set(revisions.flatMap(r => r.parents));
  return [...byId.values()].filter(r => !referenced.has(r.revisionId));
}

function decideSync(input) {return decide(input,findHeads(input.revisions));}
function decideGraph(input) {return decide(input,graphHeads(input.revisions));}
function decide({ localHash, baseHash, baseRevision, revisions },heads) {
  if (!heads.length) return baseRevision ? { action: 'remote-missing' } : { action: 'upload', parents: [] };
  if (heads.length !== 1) return { action: 'conflict', heads: heads.map(r => r.revisionId) };
  const remote = heads[0];
  if (localHash === remote.contentHash) return { action: 'unchanged', revision: remote };
  if (!baseRevision || !baseHash) return { action: 'conflict', heads: [remote.revisionId] };
  if (remote.revisionId === baseRevision) return { action: 'upload', parents: [baseRevision] };
  // Verify ancestry rather than trusting a timestamp or an unrelated baseline.
  const byId = new Map(revisions.map(r => [r.revisionId, r]));
  const seen = new Set();
  const pending = [...remote.parents];
  while (pending.length) {
    const id = pending.pop();
    if (id === baseRevision) return localHash === baseHash ? { action: 'download', revision: remote } : { action: 'conflict', heads: [remote.revisionId] };
    if (!seen.has(id)) { seen.add(id); pending.push(...(byId.get(id)?.parents || [])); }
  }
  return { action: 'conflict', heads: [remote.revisionId] };
}

module.exports = { createSnapshot, validateSnapshot, findHeads, graphHeads, decideSync, decideGraph, hash, MAX_BYTES };
