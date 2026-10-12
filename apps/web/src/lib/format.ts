export function formatError(error: unknown): string {
  if (!error) return 'Algo deu errado'
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return 'Algo deu errado'
}

export function modeLabel(mode: string): string {
  switch (mode) {
    case 'theme':
      return 'Temático'
    case 'color':
      return 'Cores'
    case 'free':
      return 'Livre'
    default:
      return mode
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'waiting':
      return 'Aberto'
    case 'ready':
      return 'Pronto'
    case 'completed':
    case 'drafted':
      return 'Sorteado'
    case 'cancelled':
    case 'closed':
      return 'Encerrado'
    default:
      return status
  }
}

export function matchSizeLabel(count: number, total: number): string {
  if (count >= total && total > 0) return `Time completo (${count})`
  if (count === 2) return 'Dupla'
  if (count === 3) return 'Trio'
  return `${count} de ${total}`
}

/** Rótulo curto da coleção (ex.: "42 skins · há 3 min"). */
export function collectionSyncLabel(
  iso: string | null | undefined,
  skinCount: number | undefined,
): string {
  if (!iso) {
    return skinCount && skinCount > 0 ? `${skinCount} skins` : 'Ainda não sincronizou'
  }
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  const when =
    mins < 1 ? 'agora' : mins < 60 ? `há ${mins} min` : `há ${Math.round(mins / 60)} h`
  return `${skinCount ?? 0} skins · ${when}`
}
