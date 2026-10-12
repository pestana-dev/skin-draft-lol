/**
 * Mantido por compatibilidade. Preferir run-tauri.mjs nos scripts npm.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

function cargoBinDirs() {
  const home = homedir()
  return [
    process.env.CARGO_HOME ? join(process.env.CARGO_HOME, 'bin') : null,
    join(home, '.cargo', 'bin'),
    join(process.env.USERPROFILE || home, '.cargo', 'bin'),
  ].filter(Boolean)
}

function ensureCargoOnPath() {
  const dirs = cargoBinDirs().filter((dir) => existsSync(dir))
  if (!dirs.length) return
  const current = process.env.PATH || ''
  const parts = current.split(delimiter).filter(Boolean)
  const missing = dirs.filter(
    (dir) => !parts.some((p) => p.toLowerCase() === dir.toLowerCase()),
  )
  if (missing.length) {
    process.env.PATH = [...missing, current].join(delimiter)
  }
}

ensureCargoOnPath()

const rustc = spawnSync('rustc', ['--version'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
  env: process.env,
})

if (rustc.status !== 0) {
  console.error('[desktop] Rust nao encontrado. Use: npm run dev:desktop')
  process.exit(1)
}

console.log(`[desktop] ${String(rustc.stdout || '').trim()}`)
