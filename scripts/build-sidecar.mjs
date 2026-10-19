import { mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const targets = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'win32-x64': 'x86_64-pc-windows-msvc',
}
const target = targets[`${process.platform}-${process.arch}`]
if (!target) throw new Error('Build the desktop sidecar on a supported Mac or Windows host')
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
run(process.execPath, ['scripts/embed-wasm.mjs'])
run(process.execPath, ['scripts/stage-keyring.mjs'])
mkdirSync(path.join(root, 'src-tauri/binaries'), { recursive: true })
const output = `src-tauri/binaries/mythpen-server-${target}${process.platform === 'win32' ? '.exe' : ''}`
run('bun', ['build', '--compile', '--external', '@napi-rs/keyring', './server/desktop.js', '--outfile', output])
console.log(`Built desktop sidecar: ${output}`)
