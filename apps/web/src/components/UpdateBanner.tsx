import { useEffect, useState } from 'react'
import { isTauri } from '../lib/desktop'

type Phase = 'idle' | 'available' | 'downloading' | 'error'

export function UpdateBanner() {
  const [phase, setPhase] = useState<Phase>('idle')
  const [version, setVersion] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isTauri()) return

    let cancelled = false

    ;(async () => {
      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        const update = await check()
        if (cancelled || !update) return
        setVersion(update.version)
        setPhase('available')
      } catch {
        // Sem rede / sem release ainda — silencioso
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  async function install() {
    setPhase('downloading')
    setError(null)
    setProgress('Baixando…')
    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const { relaunch } = await import('@tauri-apps/plugin-process')
      const update = await check()
      if (!update) {
        setPhase('idle')
        return
      }

      let downloaded = 0
      let contentLength = 0
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            contentLength = event.data.contentLength ?? 0
            setProgress('Baixando…')
            break
          case 'Progress':
            downloaded += event.data.chunkLength
            if (contentLength > 0) {
              const pct = Math.min(100, Math.round((downloaded / contentLength) * 100))
              setProgress(`Baixando… ${pct}%`)
            }
            break
          case 'Finished':
            setProgress('Instalando…')
            break
        }
      })
      await relaunch()
    } catch (e) {
      setPhase('error')
      setError(e instanceof Error ? e.message : 'Falha ao atualizar')
    }
  }

  if (phase === 'idle') return null

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--line-strong)] bg-[var(--panel)] px-4 py-3 text-sm">
      <div>
        {phase === 'available' && (
          <p className="text-[var(--text-strong)]">
            Nova versão {version ? <span className="text-[var(--gold-soft)]">v{version}</span> : null}{' '}
            disponível
          </p>
        )}
        {phase === 'downloading' && (
          <p className="text-[var(--teal-soft)]">{progress ?? 'Atualizando…'}</p>
        )}
        {phase === 'error' && (
          <p className="text-[var(--danger)]">{error ?? 'Erro ao atualizar'}</p>
        )}
      </div>
      {(phase === 'available' || phase === 'error') && (
        <button
          type="button"
          onClick={() => void install()}
          className="rounded-md bg-[var(--teal)] px-3 py-1.5 text-sm font-semibold text-[var(--ink)] transition hover:brightness-110"
        >
          {phase === 'error' ? 'Tentar de novo' : 'Atualizar agora'}
        </button>
      )}
    </div>
  )
}
