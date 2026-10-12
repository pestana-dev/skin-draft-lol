/**
 * Sincroniza rotas dos campeões (TOP/JUNGLE/MID/ADC/SUPPORT) via Meraki Analytics.
 *
 *   npm run import:roles
 *
 * Com SUPABASE_SECRET_KEY: grava direto.
 * Sem secret: gera supabase/seed-champion-roles.sql
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

const MERAKI =
  'https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions.json'

const POSITION_MAP = {
  TOP: 'TOP',
  JUNGLE: 'JUNGLE',
  MIDDLE: 'MID',
  BOTTOM: 'ADC',
  SUPPORT: 'SUPPORT',
}

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

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  ''

function sqlStr(value) {
  if (value === null || value === undefined) return 'null'
  return `'${String(value).replace(/'/g, "''")}'`
}

function mapPositions(positions) {
  const out = []
  for (const p of positions ?? []) {
    const mapped = POSITION_MAP[String(p).toUpperCase()]
    if (mapped && !out.includes(mapped)) out.push(mapped)
  }
  return out
}

async function fetchRoleMap() {
  console.log('Baixando positions do Meraki…')
  const data = await fetch(MERAKI).then((r) => {
    if (!r.ok) throw new Error(`Meraki HTTP ${r.status}`)
    return r.json()
  })

  /** @type {Array<{ id: string, roles: string[] }>} */
  const rows = []
  for (const champ of Object.values(data)) {
    const id = champ.key || champ.name
    if (!id) continue
    rows.push({ id, roles: mapPositions(champ.positions) })
  }
  rows.sort((a, b) => a.id.localeCompare(b.id))
  console.log(`${rows.length} campeões com rotas`)
  return rows
}

function writeSql(rows) {
  const dir = resolve(root, 'supabase')
  mkdirSync(dir, { recursive: true })
  const path = resolve(dir, 'seed-champion-roles.sql')
  const stmts = rows.map((r) => {
    const arr =
      r.roles.length === 0
        ? `'{}'::text[]`
        : `array[${r.roles.map(sqlStr).join(', ')}]::text[]`
    return `update public.champions set roles = ${arr} where id = ${sqlStr(r.id)};`
  })
  writeFileSync(
    path,
    `-- Gerado por npm run import:roles\nalter table public.champions add column if not exists roles text[] not null default '{}';\n\n${stmts.join('\n')}\n`,
    'utf8',
  )
  console.log(`SQL gerado: ${path}`)
}

async function upsertViaApi(rows) {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SECRET_KEY ausentes')
  }

  const BATCH = 80
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    // PostgREST não faz update parcial em batch fácil — usa RPC ou um a um.
    // Aqui: upsert só de id+roles exige todos os campos NOT NULL; então PATCH individual.
    await Promise.all(
      chunk.map(async (row) => {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/champions?id=eq.${encodeURIComponent(row.id)}`,
          {
            method: 'PATCH',
            headers: {
              apikey: SERVICE_KEY,
              Authorization: `Bearer ${SERVICE_KEY}`,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal',
            },
            body: JSON.stringify({ roles: row.roles }),
          },
        )
        if (!res.ok) {
          const text = await res.text()
          throw new Error(`PATCH ${row.id}: ${res.status} ${text}`)
        }
      }),
    )
    console.log(`  ${Math.min(i + BATCH, rows.length)}/${rows.length}`)
  }
}

async function main() {
  const rows = await fetchRoleMap()
  writeSql(rows)

  if (SERVICE_KEY && SUPABASE_URL) {
    console.log('Gravando no Supabase…')
    await upsertViaApi(rows)
    console.log('Rotas atualizadas.')
  } else {
    console.log(
      'Sem secret key — rode supabase/seed-champion-roles.sql no SQL Editor.',
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
