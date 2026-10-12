/**
 * Importa campeões e skins do Data Dragon + temas heurísticos.
 *
 * Modo A (recomendado se tiver secret key):
 *   Preencha SUPABASE_SECRET_KEY ou SUPABASE_SERVICE_ROLE_KEY no .env
 *   npm run import:catalog
 *
 * Modo B (sem secret key):
 *   npm run import:catalog
 *   → gera supabase/seed-catalog.sql
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
const BATCH = 200

const THEME_RULES = [
  { slug: 'project', name: 'PROJECT', match: /^PROJECT:/i },
  { slug: 'star-guardian', name: 'Guardiãs Estelares', match: /star guardian/i },
  { slug: 'battle-academia', name: 'Academia de Batalha', match: /battle academia|academy/i },
  { slug: 'spirit-blossom', name: 'Florescer Espiritual', match: /spirit blossom/i },
  { slug: 'true-damage', name: 'True Damage', match: /true damage/i },
  { slug: 'kda', name: 'K/DA', match: /^k\/da|kda /i },
  { slug: 'pentakill', name: 'Pentakill', match: /pentakill/i },
  { slug: 'arcade', name: 'Arcade', match: /^arcade /i },
  { slug: 'blood-moon', name: 'Lua Sangrenta', match: /blood moon/i },
  { slug: 'dark-star', name: 'Estrela Negra', match: /dark star/i },
  { slug: 'cosmic', name: 'Cósmico', match: /^cosmic |cosmic$/i },
  { slug: 'eclipse', name: 'Eclipse', match: /eclipse/i },
  { slug: 'high-noon', name: 'Meio-Dia', match: /high noon/i },
  { slug: 'odyssey', name: 'Odisseia', match: /^odyssey /i },
  { slug: 'pool-party', name: 'Festa na Piscina', match: /pool party/i },
  { slug: 'snow-day', name: 'Dia de Neve', match: /snow day|winter Wonder|winterwonder/i },
  { slug: 'halloween', name: 'Halloween', match: /bewitching|pumpkinhead|haunted|zombie/i },
  { slug: 'worlds', name: 'Worlds', match: /championship|worlds /i },
  { slug: 'victorious', name: 'Vitoriosa', match: /^victorious /i },
  { slug: 'prestige', name: 'Prestígio', match: /prestige/i },
  { slug: 'coven', name: 'Coven', match: /^coven /i },
  { slug: 'elderwood', name: 'Bosque Ancião', match: /elderwood/i },
  { slug: 'inkshadow', name: 'Inkshadow', match: /inkshadow/i },
  { slug: 'faerie-court', name: 'Corte das Fadas', match: /faerie court/i },
  { slug: 'empiryrean', name: 'Empíreo', match: /emp(?:y|i)rean/i },
  { slug: 'soul-fighter', name: 'Lutador das Almas', match: /soul fighter/i },
  { slug: 'anima-squad', name: 'Esquadrão Ânima', match: /anima squad/i },
  { slug: 'heartsteel', name: 'HEARTSTEEL', match: /heartsteel/i },
  { slug: 'porcelain', name: 'Porcelana', match: /^porcelain /i },
  { slug: 'crime-city', name: 'Crime City', match: /crime city/i },
]

function sqlStr(value) {
  if (value === null || value === undefined) return 'null'
  return `'${String(value).replace(/'/g, "''")}'`
}

function inferThemes(skinName) {
  return THEME_RULES.filter((rule) => rule.match.test(skinName))
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
  console.log(`${championList.length} campeões — baixando skins…`)

  const champions = championList.map((c) => {
    const br = championsBr.data[c.id]
    return {
      id: c.id,
      name: br?.name ?? c.name,
      key: c.key,
      image_url: `${DDRAGON}/cdn/${version}/img/champion/${c.image.full}`,
    }
  })

  const themes = THEME_RULES.map(({ slug, name }) => ({ slug, name }))
  const skins = []
  /** @type {Array<{ slug: string, skin_id: string }>} */
  const themeLinks = []
  let chromasSkipped = 0

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

    /** Nomes EN já importados — detecta chroma com mais estabilidade. */
    const seenEnNames = new Set()

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

      seenEnNames.add(enName)

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

      // Temas usam o nome EN (regex das linhas temáticas)
      for (const theme of inferThemes(enName)) {
        themeLinks.push({ slug: theme.slug, skin_id: skinId })
      }
    }

    if ((index + 1) % 20 === 0 || index === championList.length - 1) {
      console.log(`  ${index + 1}/${championList.length}`)
    }
  }

  console.log(`Chromas ignoradas: ${chromasSkipped}`)

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
      (c) =>
        `(${sqlStr(c.id)}, ${sqlStr(c.name)}, ${sqlStr(c.key)}, ${sqlStr(c.image_url)})`,
      200,
    ).map(
      (chunk) =>
        `insert into public.champions (id, name, key, image_url) values\n${chunk}\non conflict (id) do update set name = excluded.name, key = excluded.key, image_url = excluded.image_url;`,
    )
    writePart('champions', stmts.join('\n\n'))
  }

  {
    const stmts = chunkValues(
      themes,
      (t) => `(${sqlStr(t.slug)}, ${sqlStr(t.name)})`,
      200,
    ).map(
      (chunk) =>
        `insert into public.skin_themes (slug, name) values\n${chunk}\non conflict (slug) do update set name = excluded.name;`,
    )
    writePart('themes', stmts.join('\n\n'))
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

async function importViaApi({ champions, themes, skins, themeLinks }) {
  console.log('Upsert champions')
  await upsertBatch('champions', champions, 'id')
  console.log('\nUpsert themes')
  await upsertBatch('skin_themes', themes, 'slug')
  console.log('\n')

  const themeRows = await rest('skin_themes?select=id,slug')
  const themeIdBySlug = Object.fromEntries(themeRows.map((t) => [t.slug, t.id]))

  console.log(`Upsert ${skins.length} skins (sem chromas)`)
  await upsertBatch('skins', skins, 'id')
  console.log('\n')

  const members = themeLinks
    .map((m) => ({ theme_id: themeIdBySlug[m.slug], skin_id: m.skin_id }))
    .filter((m) => m.theme_id)

  console.log(`Upsert ${members.length} theme memberships`)
  await upsertBatch('skin_theme_members', members, 'theme_id,skin_id')
  console.log('\nRemovendo chromas antigas do banco…')
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
