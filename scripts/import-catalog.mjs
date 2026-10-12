/**
 * Importa campeões e skins do Data Dragon + inferência heurística de temas.
 *
 * Uso:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/import-catalog.mjs
 *
 * Ou com .env carregado pelo shell.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const DDRAGON = 'https://ddragon.leagueoflegends.com'
const BATCH = 200

/** Temas conhecidos inferidos pelo prefixo/nome da skin */
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

async function rest(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method === 'GET' ? 'return=representation' : 'resolution=merge-duplicates,return=minimal',
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
    process.stdout.write(`.`)
  }
}

function inferThemes(skinName) {
  return THEME_RULES.filter((rule) => rule.match.test(skinName))
}

async function main() {
  console.log('Buscando versão do Data Dragon…')
  const versions = await fetch(`${DDRAGON}/api/versions.json`).then((r) => r.json())
  const version = versions[0]
  console.log(`Versão: ${version}`)

  const championsJson = await fetch(
    `${DDRAGON}/cdn/${version}/data/en_US/champion.json`,
  ).then((r) => r.json())

  const championList = Object.values(championsJson.data)
  console.log(`${championList.length} campeões`)

  const champions = championList.map((c) => ({
    id: c.id,
    name: c.name,
    key: c.key,
    image_url: `${DDRAGON}/cdn/${version}/img/champion/${c.image.full}`,
  }))

  console.log('Upsert champions')
  await upsertBatch('champions', champions, 'id')
  console.log('\n')

  const themeMap = new Map()
  for (const rule of THEME_RULES) {
    themeMap.set(rule.slug, { slug: rule.slug, name: rule.name })
  }

  console.log('Upsert themes')
  await upsertBatch('skin_themes', [...themeMap.values()], 'slug')
  console.log('\n')

  const { data: themeRows } = await (async () => {
    const rows = await rest('skin_themes?select=id,slug')
    return { data: rows }
  })()
  const themeIdBySlug = Object.fromEntries(themeRows.map((t) => [t.slug, t.id]))

  const skins = []
  const themeMembers = []

  for (const [index, champ] of championList.entries()) {
    const detail = await fetch(
      `${DDRAGON}/cdn/${version}/data/en_US/champion/${champ.id}.json`,
    ).then((r) => r.json())

    const full = detail.data[champ.id]
    for (const skin of full.skins) {
      if (skin.num === 0) continue // default skin opcional no draft visual
      const skinId = `${champ.id}_${skin.num}`
      const splash = `${DDRAGON}/cdn/img/champion/splash/${champ.id}_${skin.num}.jpg`
      const tile = `${DDRAGON}/cdn/img/champion/loading/${champ.id}_${skin.num}.jpg`

      skins.push({
        id: skinId,
        champion_id: champ.id,
        name: skin.name === 'default' ? champ.name : skin.name,
        splash_url: splash,
        tile_url: tile,
        rarity: null,
        is_available: true,
        num: skin.num,
      })

      for (const theme of inferThemes(skin.name)) {
        themeMembers.push({
          theme_id: themeIdBySlug[theme.slug],
          skin_id: skinId,
        })
      }
    }

    if ((index + 1) % 20 === 0 || index === championList.length - 1) {
      console.log(`Skins: ${index + 1}/${championList.length} campeões`)
    }
  }

  console.log(`Upsert ${skins.length} skins`)
  await upsertBatch('skins', skins, 'id')
  console.log('\n')

  const members = themeMembers.filter((m) => m.theme_id)
  console.log(`Upsert ${members.length} theme memberships`)
  await upsertBatch('skin_theme_members', members, 'theme_id,skin_id')
  console.log('\nCatálogo importado com sucesso.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
