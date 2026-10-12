/**
 * Sincroniza o pool de campeões do ARAM a partir do LCU (League Client).
 *
 * Uso (com o LoL aberto na tela de seleção ARAM):
 *   npm run sync:aram -- --room=ABC123
 *
 * Requer no .env:
 *   VITE_SUPABASE_URL (ou SUPABASE_URL)
 *   VITE_SUPABASE_PUBLISHABLE_KEY (ou SUPABASE_SECRET_KEY)
 */

import { existsSync, readFileSync } from 'node:fs'
import https from 'node:https'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const POLL_MS = 2500

function loadEnv() {
  const p = resolve(root, '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnv()

function parseArgs(argv) {
  const out = { room: null, once: false }
  for (const arg of argv) {
    if (arg === '--once') out.once = true
    else if (arg.startsWith('--room=')) out.room = arg.slice('--room='.length).trim()
    else if (!arg.startsWith('-') && !out.room) out.room = arg.trim()
  }
  return out
}

function lockfileCandidates() {
  const localApp = process.env.LOCALAPPDATA || ''
  const home = homedir()
  return [
    join('C:', 'Riot Games', 'League of Legends', 'lockfile'),
    join('D:', 'Riot Games', 'League of Legends', 'lockfile'),
    join(localApp, 'Riot Games', 'League of Legends', 'lockfile'),
    join(home, 'Riot Games', 'League of Legends', 'lockfile'),
    process.env.LEAGUE_LOCKFILE || '',
  ].filter(Boolean)
}

function readLockfile() {
  for (const file of lockfileCandidates()) {
    if (!existsSync(file)) continue
    const raw = readFileSync(file, 'utf8').trim()
    const [name, pid, port, password, protocol] = raw.split(':')
    if (!port || !password) continue
    return {
      name,
      pid,
      port: Number(port),
      password,
      protocol: protocol || 'https',
      path: file,
    }
  }
  return null
}

function lcuRequest(lock, pathname) {
  const auth = Buffer.from(`riot:${lock.password}`).toString('base64')
  return new Promise((resolvePromise, reject) => {
    const req = https.request(
      {
        hostname: '127.0.0.1',
        port: lock.port,
        path: pathname,
        method: 'GET',
        rejectUnauthorized: false,
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
        })
        res.on('end', () => {
          if (res.statusCode === 404) {
            resolvePromise(null)
            return
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`LCU ${pathname} → ${res.statusCode}: ${body.slice(0, 200)}`))
            return
          }
          try {
            resolvePromise(body ? JSON.parse(body) : null)
          } catch (err) {
            reject(err)
          }
        })
      },
    )
    req.on('error', reject)
    req.end()
  })
}

function extractChampionKeys(session) {
  const keys = new Set()
  const add = (id) => {
    if (typeof id === 'number' && id > 0) keys.add(String(id))
  }

  for (const c of session.benchChampions || []) add(c.championId)
  for (const p of session.myTeam || []) add(p.championId)
  for (const p of session.theirTeam || []) add(p.championId)

  return [...keys].sort((a, b) => Number(a) - Number(b))
}

async function supabaseRpc(path, body) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY

  if (!url || !key) {
    throw new Error('Configure VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY no .env')
  }

  const res = await fetch(`${url}/rest/v1/${path}`, {
    method: path.startsWith('rpc/') ? 'POST' : 'GET',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${text}`)
  return text ? JSON.parse(text) : null
}

async function mapKeysToChampionIds(keys) {
  if (keys.length === 0) return []
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY

  const filter = keys.map(encodeURIComponent).join(',')
  const res = await fetch(
    `${url}/rest/v1/champions?select=id,key,name&key=in.(${filter})`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    },
  )
  const rows = await res.json()
  if (!res.ok) throw new Error(`champions → ${res.status}: ${JSON.stringify(rows)}`)

  const byKey = new Map(rows.map((r) => [String(r.key), r]))
  const missing = keys.filter((k) => !byKey.has(k))
  if (missing.length) {
    console.warn(`Chaves sem campeão no catálogo: ${missing.join(', ')}`)
  }
  return keys.map((k) => byKey.get(k)).filter(Boolean)
}

function sameIds(a, b) {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((v, i) => v === sb[i])
}

async function pushPool(roomCode, championIds) {
  return supabaseRpc('rpc/update_aram_pool', {
    p_code: roomCode,
    p_champion_ids: championIds,
  })
}

async function tick(roomCode, lastIds) {
  const lock = readLockfile()
  if (!lock) {
    console.log('Aguardando League Client (lockfile)…')
    return lastIds
  }

  const session = await lcuRequest(lock, '/lol-champ-select/v1/session')
  if (!session) {
    console.log('Fora da seleção de campeões — entre no ARAM e aguarde…')
    return lastIds
  }

  const keys = extractChampionKeys(session)
  const champions = await mapKeysToChampionIds(keys)
  const ids = champions.map((c) => c.id)

  if (sameIds(ids, lastIds)) {
    process.stdout.write('.')
    return lastIds
  }

  await pushPool(roomCode, ids)
  const names = champions.map((c) => c.name).join(', ') || '(vazio)'
  console.log(`\nPool atualizado (${ids.length}): ${names}`)
  return ids
}

async function main() {
  const { room, once } = parseArgs(process.argv.slice(2))
  if (!room) {
    console.error(`Uso:
  npm run sync:aram -- --room=CODIGO

Com o LoL aberto na select do ARAM. O pool da sala atualiza sozinho a cada ${POLL_MS / 1000}s.
`)
    process.exit(1)
  }

  console.log(`Skin Draft · sync ARAM → sala ${room.toUpperCase()}`)
  console.log('Ctrl+C para parar.\n')

  let last = []
  last = await tick(room, last)
  if (once) return

  setInterval(() => {
    void tick(room, last)
      .then((next) => {
        last = next
      })
      .catch((err) => {
        console.error(`\nErro: ${err.message}`)
      })
  }, POLL_MS)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
