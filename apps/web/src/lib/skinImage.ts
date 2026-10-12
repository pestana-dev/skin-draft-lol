import type { Skin } from './types'

/** Monta candidatos de imagem (tile/splash + fallback de chroma + default). */
export function skinImageCandidates(skin: Pick<Skin, 'id' | 'name' | 'champion_id' | 'num' | 'tile_url' | 'splash_url'>): string[] {
  const urls: string[] = []
  const push = (url?: string | null) => {
    if (url && !urls.includes(url)) urls.push(url)
  }

  push(skin.tile_url)
  push(skin.splash_url)

  const championId = skin.champion_id || skin.id.split('_')[0]
  const num = skin.num ?? Number(skin.id.split('_').pop())
  if (championId && Number.isFinite(num)) {
    push(`https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${championId}_${num}.jpg`)
    push(`https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championId}_${num}.jpg`)
  }

  const chromaMatch = skin.name?.match(/^(.+)\s+\([^)]+\)$/)
  if (chromaMatch && championId) {
    // Sem o num da base no cliente, tenta splash/loading da base via nome não resolve —
    // o import já corrige no banco; aqui só cai para default.
  }

  if (championId) {
    push(`https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${championId}_0.jpg`)
    push(`https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championId}_0.jpg`)
  }

  return urls
}
