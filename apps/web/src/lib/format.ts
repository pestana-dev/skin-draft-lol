export function formatError(error: unknown): string {
  if (!error) return 'Erro desconhecido'
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

export function matchSizeLabel(count: number, total: number): string {
  if (count >= total && total > 0) return `Time completo (${count})`
  if (count === 2) return 'Dupla'
  if (count === 3) return 'Trio'
  return `${count} de ${total}`
}
