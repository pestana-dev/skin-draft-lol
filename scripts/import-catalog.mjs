/**
 * Importa campeões/skins do Data Dragon + temas oficiais (skinlines) do CommunityDragon.
 *
 * Modo A (recomendado se tiver secret key):
 *   Preencha SUPABASE_SECRET_KEY ou SUPABASE_SERVICE_ROLE_KEY no .env
 *   npm run import:catalog
 *
 * Modo B (sem secret key):
 *   npm run import:catalog
 *   → gera supabase/seed-parts/*.sql
 *   → cole/rode no SQL Editor do Supabase
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

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

const DDRAGON = 'https://ddragon.leagueoflegends.com'
const MERAKI =
  'https://cdn.merakianalytics.com/riot/lol/resources/latest/en-US/champions.json'
const CDRAGON =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global'
const BATCH = 200

const POSITION_MAP = {
  TOP: 'TOP',
  JUNGLE: 'JUNGLE',
  MIDDLE: 'MID',
  BOTTOM: 'ADC',
  SUPPORT: 'SUPPORT',
}

function mapPositions(positions) {
  const out = []
  for (const p of positions ?? []) {
    const mapped = POSITION_MAP[String(p).toUpperCase()]
    if (mapped && !out.includes(mapped)) out.push(mapped)
  }
  return out
}

/** Slug estável por id oficial da skinline (CDragon). */
function skinlineSlug(id) {
  return `sl-${id}`
}

function sqlStr(value) {
  if (value === null || value === undefined) return 'null'
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * Skinlines oficiais + mapa LCU id → slugs de tema.
 * Nomes preferem pt_BR; ids batem com championKey*1000+num.
 */
async function fetchCdragonThemes() {
  console.log('Buscando skinlines oficiais (CommunityDragon)…')
  const [linesPt, linesEn, skinsRaw] = await Promise.all([
    fetch(`${CDRAGON}/pt_br/v1/skinlines.json`).then((r) => {
      if (!r.ok) throw new Error(`skinlines pt_BR → ${r.status}`)
      return r.json()
    }),
    fetch(`${CDRAGON}/default/v1/skinlines.json`).then((r) => {
      if (!r.ok) throw new Error(`skinlines en → ${r.status}`)
      return r.json()
    }),
    fetch(`${CDRAGON}/default/v1/skins.json`).then((r) => {
      if (!r.ok) throw new Error(`skins CDragon → ${r.status}`)
      return r.json()
    }),
  ])

  const nameById = new Map()
  for (const line of linesEn ?? []) {
    if (!line?.id || !normalizeName(line.name || '')) continue
    nameById.set(line.id, normalizeName(line.name))
  }
  for (const line of linesPt ?? []) {
    if (!line?.id || !normalizeName(line.name || '')) continue
    nameById.set(line.id, normalizeName(line.name))
  }

  const themes = [...nameById.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([id, name]) => ({ slug: skinlineSlug(id), name, cdragon_id: id }))

  /** @type {Map<number, string[]>} */
  const themeSlugsByLcuId = new Map()
  const skinEntries = Array.isArray(skinsRaw)
    ? skinsRaw
    : Object.values(skinsRaw ?? {})

  for (const skin of skinEntries) {
    const lcuId = Number(skin?.id)
    if (!Number.isFinite(lcuId) || lcuId <= 0) continue
    const lineIds = (skin.skinLines ?? [])
      .map((l) => Number(l?.id))
      .filter((id) => Number.isFinite(id) && nameById.has(id))
    if (lineIds.length === 0) continue
    themeSlugsByLcuId.set(
      lcuId,
      lineIds.map((id) => skinlineSlug(id)),
    )
  }

  console.log(
    `${themes.length} skinlines · ${themeSlugsByLcuId.size} skins com linha temática`,
  )
  return { themes, themeSlugsByLcuId }
}

function normalizeName(name) {
  return String(name).replace(/\s+/g, ' ').trim()
}

/** Chromas usam o nome "Skin (Cor)" — ex.: "Odyssey Aatrox (Ruby)". */
function chromaBaseName(skinName) {
  const match = normalizeName(skinName).match(/^(.+) \([^)]+\)$/)
  return match ? match[1] : null
}

function skinArtUrls(championId, artNum) {
  return {
    splash_url: `${DDRAGON}/cdn/img/champion/splash/${championId}_${artNum}.jpg`,
    tile_url: `${DDRAGON}/cdn/img/champion/loading/${championId}_${artNum}.jpg`,
  }
}

async function rest(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:
        method === 'GET'
          ? 'return=representation'
          : method === 'DELETE'
            ? 'return=minimal'
            : 'resolution=merge-duplicates,return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${method} ${path} → ${res.status}: ${text}`)
  }
  if (res.status === 204) return null
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) return res.json()
  return null
}

async function upsertBatch(table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const qs = onConflict ? `?on_conflict=${onConflict}` : ''
    await rest(`${table}${qs}`, { method: 'POST', body: chunk })
    process.stdout.write('.')
  }
}

function chunkValues(rows, toSqlRow, size = 150) {
  const parts = []
  for (let i = 0; i < rows.length; i += size) {
    parts.push(rows.slice(i, i + size).map(toSqlRow).join(',\n'))
  }
  return parts
}

async function fetchCatalog() {
  console.log('Buscando versão do Data Dragon…')
  const versions = await fetch(`${DDRAGON}/api/versions.json`).then((r) => r.json())
  const version = versions[0]
  console.log(`Versão: ${version} · nomes em pt_BR`)

  const [championsEn, championsBr] = await Promise.all([
    fetch(`${DDRAGON}/cdn/${version}/data/en_US/champion.json`).then((r) => r.json()),
    fetch(`${DDRAGON}/cdn/${version}/data/pt_BR/champion.json`).then((r) => r.json()),
  ])

  const championList = Object.values(championsEn.data)
  console.log(`${championList.length} campeões — baixando skins + rotas…`)

  let merakiByKey = {}
  try {
    const meraki = await fetch(MERAKI).then((r) => r.json())
    merakiByKey = Object.fromEntries(
      Object.values(meraki).map((c) => [c.key || c.name, c]),
    )
  } catch (err) {
    console.warn('Meraki roles indisponível:', err.message)
  }

  const champions = championList.map((c) => {
    const br = championsBr.data[c.id]
    const meraki = merakiByKey[c.id]
    return {
      id: c.id,
      name: br?.name ?? c.name,
      key: c.key,
      image_url: `${DDRAGON}/cdn/${version}/img/champion/${c.image.full}`,
      roles: mapPositions(meraki?.positions),
    }
  })

  const { themes: cdragonThemes, themeSlugsByLcuId } = await fetchCdragonThemes()
  const themes = cdragonThemes.map(({ slug, name }) => ({ slug, name }))
  const skins = []
  /** @type {Array<{ slug: string, skin_id: string }>} */
  const themeLinks = []
  let chromasSkipped = 0
  let themeHits = 0
  let skinsWithoutLine = 0

  for (const [index, champ] of championList.entries()) {
    const [detailEn, detailBr] = await Promise.all([
      fetch(`${DDRAGON}/cdn/${version}/data/en_US/champion/${champ.id}.json`).then((r) =>
        r.json(),
      ),
      fetch(`${DDRAGON}/cdn/${version}/data/pt_BR/champion/${champ.id}.json`).then((r) =>
        r.json(),
      ),
    ])

    const enSkins = detailEn.data[champ.id].skins
    const brSkins = detailBr.data[champ.id].skins
    const brNameByNum = new Map(brSkins.map((s) => [s.num, s.name]))
    const championBrName = championsBr.data[champ.id]?.name ?? champ.name
    const championKey = Number(champ.key)

    for (const skin of enSkins) {
      if (skin.num === 0) continue

      const enName = normalizeName(
        skin.name === 'default' ? champ.name : skin.name,
      )

      // Qualquer "Skin (Variante)" — chromas, ranks, BADDEST, etc.
      if (chromaBaseName(enName)) {
        chromasSkipped += 1
        continue
      }

      const brRaw = brNameByNum.get(skin.num)
      const displayName = normalizeName(
        !brRaw || brRaw === 'default' ? championBrName : brRaw,
      )

      const skinId = `${champ.id}_${skin.num}`
      const art = skinArtUrls(champ.id, skin.num)
      skins.push({
        id: skinId,
        champion_id: champ.id,
        name: displayName,
        splash_url: art.splash_url,
        tile_url: art.tile_url,
        rarity: null,
        is_available: true,
        num: skin.num,
      })

      const lcuId = championKey * 1000 + Number(skin.num)
      const slugs = themeSlugsByLcuId.get(lcuId)
      if (!slugs?.length) {
        skinsWithoutLine += 1
        continue
      }
      for (const slug of slugs) {
        themeLinks.push({ slug, skin_id: skinId })
        themeHits += 1
      }
    }

    if ((index + 1) % 20 === 0 || index === championList.length - 1) {
      console.log(`  ${index + 1}/${championList.length}`)
    }
  }

  console.log(`Chromas ignoradas: ${chromasSkipped}`)
  console.log(
    `Vínculos tema↔skin: ${themeHits} · skins sem skinline: ${skinsWithoutLine}`,
  )

  return { champions, themes, skins, themeLinks }
}

function writeSqlSeed({ champions, themes, skins, themeLinks }) {
  const partsDir = resolve(root, 'supabase', 'seed-parts')
  mkdirSync(partsDir, { recursive: true })

  /** @type {string[]} */
  const partFiles = []
  let partIndex = 0

  function writePart(name, body) {
    partIndex += 1
    const fileName = `${String(partIndex).padStart(2, '0')}-${name}.sql`
    const full = resolve(partsDir, fileName)
    writeFileSync(
      full,
      `-- Parte ${partIndex}: ${name}\n-- Rode no SQL Editor do Supabase (Run)\n\n${body}\n`,
      'utf8',
    )
    partFiles.push(full)
  }

  {
    const stmts = chunkValues(
      champions,
      (c) => {
        const roles =
          (c.roles?.length ?? 0) === 0
            ? `'{}'::text[]`
            : `array[${c.roles.map(sqlStr).join(', ')}]::text[]`
        return `(${sqlStr(c.id)}, ${sqlStr(c.name)}, ${sqlStr(c.key)}, ${sqlStr(c.image_url)}, ${roles})`
      },
      200,
    ).map(
      (chunk) =>
        `insert into public.champions (id, name, key, image_url, roles) values\n${chunk}\non conflict (id) do update set name = excluded.name, key = excluded.key, image_url = excluded.image_url, roles = excluded.roles;`,
    )
    writePart('champions', stmts.join('\n\n'))
  }

  {
    const reset = `truncate table public.skin_theme_members;
delete from public.skin_themes;`
    const stmts = chunkValues(
      themes,
      (t) => `(${sqlStr(t.slug)}, ${sqlStr(t.name)})`,
      200,
    ).map(
      (chunk) =>
        `insert into public.skin_themes (slug, name) values\n${chunk}\non conflict (slug) do update set name = excluded.name;`,
    )
    writePart('themes', [reset, ...stmts].join('\n\n'))
  }

  {
    const skinChunks = chunkValues(
      skins,
      (s) =>
        `(${sqlStr(s.id)}, ${sqlStr(s.champion_id)}, ${sqlStr(s.name)}, ${sqlStr(s.splash_url)}, ${sqlStr(s.tile_url)}, ${sqlStr(s.rarity)}, ${s.is_available}, ${s.num})`,
      120,
    )
    const perFile = 8
    for (let i = 0; i < skinChunks.length; i += perFile) {
      const stmts = skinChunks.slice(i, i + perFile).map(
        (chunk) =>
          `insert into public.skins (id, champion_id, name, splash_url, tile_url, rarity, is_available, num) values\n${chunk}\non conflict (id) do update set
  champion_id = excluded.champion_id,
  name = excluded.name,
  splash_url = excluded.splash_url,
  tile_url = excluded.tile_url,
  rarity = excluded.rarity,
  is_available = excluded.is_available,
  num = excluded.num;`,
      )
      writePart(`skins-${Math.floor(i / perFile) + 1}`, stmts.join('\n\n'))
    }
  }

  {
    const memberChunks = chunkValues(
      themeLinks,
      (m) =>
        `((select id from public.skin_themes where slug = ${sqlStr(m.slug)}), ${sqlStr(m.skin_id)})`,
      120,
    )
    const perFile = 8
    for (let i = 0; i < memberChunks.length; i += perFile) {
      const stmts = memberChunks.slice(i, i + perFile).map(
        (chunk) =>
          `insert into public.skin_theme_members (theme_id, skin_id) values\n${chunk}\non conflict (theme_id, skin_id) do nothing;`,
      )
      writePart(`themes-members-${Math.floor(i / perFile) + 1}`, stmts.join('\n\n'))
    }
  }

  const indexPath = resolve(partsDir, '00-README.txt')
  writeFileSync(
    indexPath,
    `Rode os arquivos .sql em ordem numérica no SQL Editor do Supabase.
Projeto: https://supabase.com/dashboard/project/acwnyysvrwroxswoivjn/sql/new

Arquivos:
${partFiles.map((f, i) => `${i + 1}. ${f.split(/[/\\\\]/).pop()}`).join('\n')}
`,
    'utf8',
  )

  return partsDir
}

async function deleteStaleSkins(keepIds) {
  const keep = new Set(keepIds)
  const allIds = []
  let offset = 0
  const page = 1000

  for (;;) {
    const rows = await rest(`skins?select=id&order=id&limit=${page}&offset=${offset}`)
    if (!rows?.length) break
    allIds.push(...rows.map((r) => r.id))
    if (rows.length < page) break
    offset += page
  }

  const stale = allIds.filter((id) => !keep.has(id))
  for (let i = 0; i < stale.length; i += BATCH) {
    const chunk = stale.slice(i, i + BATCH)
    const filter = chunk.map(encodeURIComponent).join(',')
    await rest(`skins?id=in.(${filter})`, { method: 'DELETE' })
    process.stdout.write('x')
  }

  return stale.length
}

async function replaceThemeMemberships(themes, themeLinks) {
  console.log('Substituindo temas (skinlines CDragon)…')
  // Limpa vínculos antigos (regex/heurística) antes de gravar os oficiais
  await rest('skin_theme_members?theme_id=not.is.null', { method: 'DELETE' })
  await upsertBatch('skin_themes', themes, 'slug')
  console.log('')

  const themeRows = await rest('skin_themes?select=id,slug')
  const keepSlugs = new Set(themes.map((t) => t.slug))
  const themeIdBySlug = Object.fromEntries(
    (themeRows ?? []).map((t) => [t.slug, t.id]),
  )

  const staleThemes = (themeRows ?? []).filter((t) => !keepSlugs.has(t.slug))
  for (let i = 0; i < staleThemes.length; i += BATCH) {
    const chunk = staleThemes.slice(i, i + BATCH)
    const filter = chunk.map((t) => encodeURIComponent(t.id)).join(',')
    await rest(`skin_themes?id=in.(${filter})`, { method: 'DELETE' })
  }
  if (staleThemes.length) {
    console.log(`${staleThemes.length} temas antigos removidos`)
  }

  const members = themeLinks
    .map((m) => ({ theme_id: themeIdBySlug[m.slug], skin_id: m.skin_id }))
    .filter((m) => m.theme_id)

  console.log(`Inserindo ${members.length} vínculos tema↔skin`)
  await upsertBatch('skin_theme_members', members, 'theme_id,skin_id')
  console.log('')
}

async function importViaApi({ champions, themes, skins, themeLinks }) {
  console.log('Upsert champions')
  await upsertBatch('champions', champions, 'id')
  console.log('\n')

  console.log(`Upsert ${skins.length} skins (sem chromas)`)
  await upsertBatch('skins', skins, 'id')
  console.log('\n')

  await replaceThemeMemberships(themes, themeLinks)

  console.log('Removendo chromas antigas do banco…')
  const removed = await deleteStaleSkins(skins.map((s) => s.id))
  console.log(`\n${removed} skins removidas. Catálogo importado via API.`)
}

async function main() {
  const catalog = await fetchCatalog()
  console.log(
    `Pronto: ${catalog.champions.length} campeões, ${catalog.skins.length} skins, ${catalog.themeLinks.length} vínculos de tema.`,
  )

  if (SERVICE_KEY && SUPABASE_URL) {
    console.log('Secret key encontrada — importando direto no Supabase…')
    await importViaApi(catalog)
    return
  }

  console.log('\nNenhuma secret key no .env — gerando SQL em partes…')
  const outDir = writeSqlSeed(catalog)
  console.log(`\nPasta gerada:\n  ${outDir}`)
  console.log(`
Próximo passo (sem secret key):
1. Abra https://supabase.com/dashboard/project/acwnyysvrwroxswoivjn/sql/new
2. Rode cada arquivo .sql de supabase/seed-parts/ em ordem (01, 02, 03…)
3. Em cada um: abrir → colar → Run

Caminho mais fácil (com secret key):
1. Dashboard → Project Settings → API Keys → Secret key (sb_secret_...)
2. Cole em SUPABASE_SECRET_KEY no .env
3. npm run import:catalog   ← grava as ~9k skins sozinho
`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
