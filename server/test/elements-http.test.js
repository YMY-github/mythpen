const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mythpen-elements-'));
process.env.MYTHPEN_DATA_DIR = root;
const db = require('../db'), express = require('express');
const name = '要素修改回归作品';
let server, url;
const longText = ' 首行保留空格\n\n' + '长篇设定与科学约束。'.repeat(3000) + '\n最后一行 '; 
const fixtures = {
  characters: { name: '角色甲', background: '原背景', notes: '原备注' },
  world: { category: 'technology', name: '技术设定', description: '原描述', tags: '原标签' },
  science: { label: 'known', name: '科学设定', description: '原描述', references: '参考一' },
  foreshadows: { title: '伏笔', description: '原描述', priority: 'normal', status: 'planted', expected_resolve_chapter: 2 },
  memories: { category: 'promise', content: '原记忆', source_chapter_id: 1 },
  timeline: { year: '第一年', title: '初始事件', description: '原描述', importance: 3 },
};
const ids = {};
async function request(route, method = 'GET', body) {
  const response = await fetch(url + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  return { status: response.status, data };
}
before(async () => {
  await db.initDatabase();
  db.getProjectDb(name);
  db.projectExecute(name, "INSERT INTO volumes (id,sort_order,title) VALUES (1,1,'卷一')");
  db.projectExecute(name, "INSERT INTO chapters (id,volume_id,num,title) VALUES (1,1,1,'一章')");
  const app = express(); app.use(express.json({ limit: '2mb' })); app.use('/api', require('../routes/api'));
  server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  url = `http://127.0.0.1:${server.address().port}/api/${encodeURIComponent(name)}`;
  for (const [kind, body] of Object.entries(fixtures)) {
    const result = await request(`/${kind}`, 'POST', body); assert.equal(result.status, 201); ids[kind] = result.data.id;
  }
  const other = await request('/characters', 'POST', { name: '角色乙' });
  ids.other = other.data.id;
  ids.relations = (await request('/relations', 'POST', { character_a_id: ids.characters, character_b_id: ids.other, relation_type: '朋友', description: '原关系' })).data.id;
  db.projectExecute(name, 'INSERT INTO chapter_characters (chapter_id,character_id) VALUES (1,?)', [ids.characters]);
  db.projectExecute(name, 'UPDATE foreshadows SET planted_chapter_id=1 WHERE id=?', [ids.foreshadows]);
});
after(async () => { await new Promise(resolve => server.close(resolve)); db.closeProjectDb(db.getProjectDbPath(name)); db.getConfigDb().close(); fs.rmSync(root, { recursive: true, force: true }); });
const changes = {
  characters: { name: '角色甲改名', background: longText, notes: '' },
  world: { category: 'concept', name: '概念改名', description: longText, tags: '' },
  science: { label: 'hypothesis', name: '科学改名', description: longText, references: '新参考\n第二条' },
  foreshadows: { title: '已回收伏笔', description: longText, priority: 'high', status: 'resolved', expected_resolve_chapter: 9 },
  relations: { relation_type: '对手', description: longText, intensity: 5, started_at: '第二年', ended_at: '第三年' },
  memories: { category: 'event', content: longText },
  timeline: { year: '第二年', title: '新事件', description: longText, importance: 5 },
};
for (const [kind, body] of Object.entries(changes)) {
  test(`${kind}: update original ID, persist full long text and preserve omitted fields after DB reopen`, async () => {
    const before = (await request(`/${kind}`)).data.find(row => row.id === ids[kind]);
    const result = await request(`/${kind}/${ids[kind]}`, 'PUT', body); assert.equal(result.status, 200);
    db.closeProjectDb(db.getProjectDbPath(name));
    const rows = (await request(`/${kind}`)).data;
    const saved = rows.find(row => row.id === ids[kind]);
    assert.equal(rows.length, kind === 'characters' ? 2 : 1);
    for (const [key, value] of Object.entries(body)) assert.equal(saved[key], value);
    for (const key of Object.keys(before).filter(key => !(key in body) && key !== 'updated_at')) assert.deepEqual(saved[key], before[key]);
  });
  test(`${kind}: rejects missing records and empty updates`, async () => {
    assert.equal((await request(`/${kind}/missing`, 'PUT', body)).status, 404);
    assert.equal((await request(`/${kind}/${ids[kind]}`, 'PUT', {})).status, 400);
  });
}
test('invalid updates cannot partially change a record or overwrite its ID', async () => {
  for (const [kind, body] of [['characters',{name:' '}],['science',{name:'不可保存',label:'invalid'}],['foreshadows',{status:'invalid'}],['foreshadows',{expected_resolve_chapter:-1}],['relations',{character_a_id:'missing'}],['relations',{intensity:6}],['memories',{content:''}],['memories',{category:'invalid'}],['timeline',{importance:1.5}],['world',{description:null}]]) {
    const before = (await request(`/${kind}`)).data;
    assert.equal((await request(`/${kind}/${ids[kind]}`, 'PUT', body)).status, 400);
    assert.deepEqual((await request(`/${kind}`)).data, before);
  }
  assert.equal((await request(`/world/${ids.world}`, 'PUT', { id: 'replacement', description: '' })).status, 200);
  assert.ok((await request('/world')).data.some(row => row.id === ids.world && row.description === ''));
  assert.equal(db.projectGet(name, 'SELECT character_id FROM chapter_characters').character_id, ids.characters);
  assert.equal(db.projectGet(name, 'SELECT source_chapter_id FROM memories').source_chapter_id, 1);
  assert.equal(db.projectGet(name, 'SELECT planted_chapter_id FROM foreshadows').planted_chapter_id, 1);
});
