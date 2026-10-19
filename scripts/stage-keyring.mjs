import { createRequire } from 'node:module'
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
const require = createRequire(import.meta.url)
const platform = `${process.platform}-${process.arch}`
if (!['darwin-arm64', 'darwin-x64', 'win32-x64-msvc', 'win32-arm64-msvc'].includes(platform === 'win32-x64' || platform === 'win32-arm64' ? `${platform}-msvc` : platform)) {
  throw new Error('Cloud-sync desktop builds currently support macOS and Windows only')
}
const entry = require.resolve('@napi-rs/keyring')
const packageRequire = createRequire(entry)
const suffix = process.platform === 'win32' ? `${platform}-msvc` : platform
const native = packageRequire.resolve(`@napi-rs/keyring-${suffix}`)
const destination = path.resolve('src-tauri/resources/sync-keyring')
rmSync(destination, { recursive: true, force: true })
mkdirSync(destination, { recursive: true })
cpSync(path.join(path.dirname(entry), 'LICENSE'), path.join(destination, 'LICENSE'))
cpSync(entry, path.join(destination, 'index.js'))
cpSync(native, path.join(destination, path.basename(native)))
writeFileSync(path.join(destination, 'package.json'), JSON.stringify({ type: 'commonjs', main: 'index.js' }))
cpSync(path.join(path.dirname(entry), 'package.json'), path.join(destination, 'UPSTREAM_PACKAGE.json'))
console.log(`Staged native credential binding for ${suffix}`)
