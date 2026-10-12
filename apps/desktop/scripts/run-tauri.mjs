import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))

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
  console.error(`
[desktop] Rust nao encontrado no PATH deste terminal.

Voce instalou o rustup, mas o npm/cmd ainda nao ve o cargo.

Faça um destes:
  1. Feche TODOS os terminais e o Cursor, abra de novo, e rode:
       npm run dev:desktop
  2. Ou neste terminal Git Bash:
       export PATH="$HOME/.cargo/bin:$PATH"
       npm run dev:desktop

Confirme com:
  rustc --version
  cargo --version
`)
  process.exit(1)
}

const cargo = spawnSync('cargo', ['--version'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
  env: process.env,
})

if (cargo.status !== 0) {
  console.error('[desktop] rustc ok, mas cargo nao foi encontrado no PATH.')
  process.exit(1)
}

console.log(`[desktop] ${String(rustc.stdout || '').trim()}`)
console.log(`[desktop] ${String(cargo.stdout || '').trim()}`)

const args = process.argv.slice(2)
if (!args.length) {
  console.error('Uso: node scripts/run-tauri.mjs <dev|build|...>')
  process.exit(1)
}

let tauriBin
try {
  tauriBin = require.resolve('@tauri-apps/cli/tauri.js')
} catch {
  tauriBin = require.resolve('@tauri-apps/cli')
}

const child = spawn(process.execPath, [tauriBin, ...args], {
  stdio: 'inherit',
  env: process.env,
  cwd: join(__dirname, '..'),
  shell: false,
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
