const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const db = require('../db');
const { createSnapshot, validateSnapshot, MAX_BYTES } = require('./snapshot');

function atomicWrite(file, bytes) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, bytes, { mode: 0o600 });
    fs.renameSync(temp, file);
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

function deviceId() {
  const file = path.join(db.DB_DIR, 'sync-device.json');
  if (!fs.existsSync(file)) atomicWrite(file, JSON.stringify({ id: randomUUID() }));
  return JSON.parse(fs.readFileSync(file, 'utf8')).id;
}

function capture(name, parents = []) {
  const file = db.getProjectDbPath(name);
  if (!db.projectExists(name)) throw new Error('Project not found');
  const project = db.getProjectDb(name);
  let id = project.prepare("SELECT value FROM project_meta WHERE key = 'sync_project_id'").get()?.value;
  if (!id) {
    id = randomUUID();
    project.prepare("INSERT INTO project_meta (key,value) VALUES ('sync_project_id',?)").run(id);
  }
  // Export and read resources synchronously in one event-loop turn, after writes.
  const database = project.exportBytes();
  const coverFile = db.findCoverPath(name);
  return createSnapshot({ projectId: id, deviceId: deviceId(), parents, database,
    cover: coverFile ? { name: path.basename(coverFile), bytes: fs.readFileSync(coverFile) } : null });
}

function saveBackup(snapshot) {
  validateSnapshot(snapshot);
  const dir = path.join(db.DB_DIR, 'backups', snapshot.projectId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${snapshot.revisionId}.json`);
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') !== JSON.stringify(snapshot)) throw new Error('Revision collision');
  } else atomicWrite(file, JSON.stringify(snapshot));
  return file;
}

function listBackups(name) {
  const snapshot = capture(name);
  const dir = path.join(db.DB_DIR, 'backups', snapshot.projectId);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(file => /^[0-9a-f-]{36}\.json$/.test(file)).map(file => {
    try {
      const s=readSnapshot(path.join(dir,file));
      if(s.projectId!==snapshot.projectId || `${s.revisionId}.json`!==file) throw new Error('Backup identity mismatch');
      return { revisionId: s.revisionId, createdAt: s.createdAt, deviceId: s.deviceId, bytes: s.files.reduce((n,f) => n + f.size, 0) };
    } catch {
      return {revisionId:file.slice(0,-5),createdAt:'',bytes:0,invalid:true};
    }
  }).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
}

function readSnapshot(file) {
  if (fs.statSync(file).size > MAX_BYTES * 1.4) throw new Error('Snapshot too large');
  const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
  validateSnapshot(snapshot);
  return snapshot;
}

// Core recovery primitive. HTTP/UI restore must additionally guard unsaved editor text.
function restore(name, snapshot, expectedHash) {
  const files = validateSnapshot(snapshot);
  db.validateProjectBytes(files.get('project.db'), snapshot.projectId);
  const current = capture(name);
  if (current.projectId !== snapshot.projectId) throw new Error('Project identity mismatch');
  if (current.contentHash !== expectedHash) throw new Error('Local project changed');
  saveBackup(current);
  const dir = path.join(db.DB_DIR, 'sync-recovery');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const journal = path.join(dir, 'pending.json');
  if (fs.existsSync(journal)) throw new Error('Pending recovery must be completed first');
  // Journal survives a crash between replacing the database and cover.
  atomicWrite(journal, JSON.stringify({ name, snapshot }));
  apply(name, snapshot);
  fs.unlinkSync(journal);
  return capture(name, [snapshot.revisionId, current.revisionId]);
}

function apply(name, snapshot) {
  const files = validateSnapshot(snapshot);
  db.validateProjectBytes(files.get('project.db'), snapshot.projectId);
  db.closeProjectDb(db.getProjectDbPath(name));
  atomicWrite(db.getProjectDbPath(name), files.get('project.db'));
  const dir = db.getCoverDir(name);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const [file, bytes] of files) if (file !== 'project.db') atomicWrite(path.join(dir, file), bytes);
  for (const ext of ['png','jpg','webp','gif']) {
    const file = `cover.${ext}`;
    if (!files.has(file) && fs.existsSync(path.join(dir,file))) fs.unlinkSync(path.join(dir,file));
  }
  db.notifyProjectChanged(db.getProjectDbPath(name));
}

function recoverPending() {
  const journal = path.join(db.DB_DIR, 'sync-recovery', 'pending.json');
  if (!fs.existsSync(journal)) return false;
  const { name, snapshot, imported } = readJournal(journal);
  apply(name, snapshot);
  if (imported) register(name);
  fs.unlinkSync(journal);
  return true;
}
function readJournal(file) {
  if (fs.statSync(file).size > MAX_BYTES * 1.4) throw new Error('Recovery journal too large');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function register(name) {
  db.dbExecute('INSERT OR REPLACE INTO recent_projects (id,name,file_path,last_opened,word_count) VALUES (?,?,?,?,?)', [name,name,db.getProjectDbPath(name),new Date().toISOString(),0]);
  db.getConfigDb().exportBytes();
}
function importProject(name, snapshot, clone = false) {
  db.validateProjectName(name);
  if (db.projectExists(name)) throw new Error('Local project already exists');
  const files = validateSnapshot(snapshot);
  db.validateProjectBytes(files.get('project.db'), snapshot.projectId);
  if (!clone) {
    for (const project of db.dbQuery('SELECT name FROM recent_projects')) {
      if (!db.projectExists(project.name)) continue;
      const id=db.projectGet(project.name,"SELECT value FROM project_meta WHERE key = 'sync_project_id'")?.value;
      if (id===snapshot.projectId) throw new Error('This cloud project is already on this device');
    }
  }
  const projectId = clone ? randomUUID() : snapshot.projectId;
  const database = db.transformProjectBytes(files.get('project.db'), name, projectId);
  const cover = [...files].find(([file]) => file !== 'project.db');
  const imported = createSnapshot({ projectId, deviceId: deviceId(), database, cover: cover ? { name: cover[0], bytes: cover[1] } : null });
  const directory = path.join(db.DB_DIR,'sync-recovery');
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const journal=path.join(directory,'pending.json');
  if (fs.existsSync(journal)) throw new Error('Pending recovery must be completed first');
  atomicWrite(journal,JSON.stringify({name,snapshot:imported,imported:true}));
  apply(name,imported);register(name);fs.unlinkSync(journal);
  return imported;
}
function restoreBackup(name,revisionId,expectedHash) {
  if(typeof revisionId!=='string' || !/^[0-9a-f-]{36}$/i.test(revisionId)) throw new Error('Invalid backup identity');
  const current=capture(name);
  const snapshot=readSnapshot(path.join(db.DB_DIR,'backups',current.projectId,`${revisionId}.json`));
  const restored=restore(name,snapshot,expectedHash);saveBackup(restored);
  return {revisionId:restored.revisionId};
}
module.exports = { importProject, capture, saveBackup, listBackups, readSnapshot, restore, restoreBackup, recoverPending, atomicWrite };
