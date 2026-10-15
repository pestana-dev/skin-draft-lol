/**
 * Fonte de verdade da fila:
 * 1) LCU explícito (sr|aram)
 * 2) party LCU com sinais (bench → aram; queueId/select → sr)
 * 3) room / analyze
 * Nunca promove unknown→aram só por pool residual.
 */
export function resolveQueueKind(input: {
  lcuQueueKind?: string | null
  partyId?: string | null
  queueId?: number | null
  inChampSelect?: boolean
  benchEnabled?: boolean
  dataQueueKind?: string | null
  roomQueueKind?: string | null
}): string {
  const lcu = input.lcuQueueKind
  if (lcu === 'sr' || lcu === 'aram') return lcu

  if (input.partyId) {
    if (input.benchEnabled) return 'aram'
    if (input.queueId || input.inChampSelect) return 'sr'
    return 'unknown'
  }

  const fallback = input.dataQueueKind ?? input.roomQueueKind ?? 'unknown'
  if (fallback === 'sr') return 'sr'
  if (fallback === 'aram') return 'aram'
  if (input.benchEnabled) return 'aram'
  return fallback
}
