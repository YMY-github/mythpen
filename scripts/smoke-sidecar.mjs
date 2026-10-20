import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const targets = { 'darwin-arm64': 'aarch64-apple-darwin', 'darwin-x64': 'x86_64-apple-darwin', 'win32-x64': 'x86_64-pc-windows-msvc' }
const target = targets[`${process.platform}-${process.arch}`]
if (!target) throw new Error('Run the sidecar smoke test on a supported Mac or Windows host')
const executable = path.resolve(process.argv[2] || path.join(root, `src-tauri/binaries/mythpen-server-${target}${process.platform === 'win32' ? '.exe' : ''}`))
const keyring = path.resolve(process.argv[3] || path.join(root, 'src-tauri/resources/sync-keyring/index.js'))
const directory = mkdtempSync(path.join(os.tmpdir(), 'mythpen-package-check-'))
const token = randomUUID()
const env = { ...process.env, MYTHPEN_DATA_DIR: directory, MYTHPEN_KEYRING_DIR: keyring, MYTHPEN_SIDECAR_TOKEN: token }
let child
let output = ''
try {
  const check = spawnSync(executable, ['--check-credentials'], { env, cwd: directory, encoding: 'utf8', timeout: 30000 })
  assert.equal(check.status, 0, check.stderr || check.error?.message || 'Packaged credential check failed')
  const probe = net.createServer()
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve))
  const port = probe.address().port
  await new Promise(resolve => probe.close(resolve))
  child = spawn(executable, [], { env: { ...env, PORT: String(port) }, cwd: directory })
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  const exited = new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
  const url = `http://127.0.0.1:${port}/api`
  async function request(route, body, authorized = false, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(`${url}${route}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(authorized ? { 'X-Mythpen-Sidecar-Token': token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(3000),
    })
    return { response, data: await response.json() }
  }
  let healthy = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`Packaged server exited: ${output}`)
    try {
      const { response, data } = await request('/health', undefined, true)
      if (response.ok && data.sidecarOwned === true) { healthy = true; break }
    } catch { /* Wait for cold startup. */ }
    await delay(200)
  }
  assert.ok(healthy, output || 'Packaged server startup timed out')
  assert.equal((await request('/health')).data.sidecarOwned, false)
  assert.equal((await request('/projects', { name: 'desktop-package-smoke' })).response.status, 200)
  assert.equal((await request('/sync/documents/open', {name:'desktop-package-smoke'})).data.action,'local')
  assert.equal((await request('/sync/documents/catalog', {})).data.local,true)
  assert.equal((await request('/desktop-package-smoke/chapters', { title: 'Packaged chapter' })).response.status, 201)
  assert.equal((await request('/desktop-package-smoke/chapters/1', { content: 'Synthetic installed-app check' }, false, 'PUT')).response.status, 200)
  assert.equal((await request('/desktop-package-smoke/chapters/1')).data.content, 'Synthetic installed-app check')
  const cover = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
  assert.equal((await request('/desktop-package-smoke/cover', { data: cover, mime: 'image/png' })).response.status, 200)
  const coverResponse = await fetch(`${url}/desktop-package-smoke/cover`)
  assert.equal(coverResponse.status, 200)
  assert.equal(Buffer.from(await coverResponse.arrayBuffer()).toString('base64'), cover)
  const backup = await request('/sync/projects/desktop-package-smoke/backups', {})
  assert.ok(backup.data.revisionId)
  assert.equal((await request('/sync/projects/desktop-package-smoke/backups')).data.length, 1)
  const expected = (await request('/sync/projects/desktop-package-smoke/local-status')).data.currentHash
  await request('/desktop-package-smoke/chapters/1', { content: 'Later synthetic content' }, false, 'PUT')
  assert.equal((await request(`/sync/projects/desktop-package-smoke/backups/${backup.data.revisionId}/restore`, { expectedHash: expected })).response.status, 400)
  const current = (await request('/sync/projects/desktop-package-smoke/local-status')).data.currentHash
  assert.equal((await request(`/sync/projects/desktop-package-smoke/backups/${backup.data.revisionId}/restore`, { expectedHash: current })).response.status, 200)
  assert.equal((await request('/desktop-package-smoke/chapters/1')).data.content, 'Synthetic installed-app check')
  const diagnostics = await request('/sync/diagnostics')
  assert.equal(diagnostics.data.telemetry, false)
  assert.ok(!JSON.stringify(diagnostics.data).includes(directory))
  assert.equal((await request('/sync/status')).data.configured, false)
  assert.equal((await request('/shutdown', {})).response.status, 401)
  assert.equal((await request('/health', undefined, true)).data.sidecarOwned, true)
  assert.equal((await request('/shutdown', {}, true)).response.status, 200)
  assert.equal(await exited, 0)
  assert.ok(!output.includes(directory), 'Logs must not disclose the private data directory')
  assert.ok(!output.includes('Synthetic installed-app check'), 'Logs must not disclose manuscript content')
  console.log('Packaged sidecar, credential store, database, backup and owned shutdown checks passed')
} finally {
  if (child && child.exitCode === null) {
    child.kill()
    await new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 5000).unref() })
  }
  rmSync(directory, { recursive: true, force: true })
}
