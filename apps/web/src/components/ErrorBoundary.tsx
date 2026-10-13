import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  fallbackTitle?: string
}

type State = {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI crash:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-[var(--radius)] border border-[var(--line)] bg-[var(--panel)] p-6">
          <h1 className="font-display text-2xl">
            {this.props.fallbackTitle ?? 'Algo quebrou nesta tela'}
          </h1>
          <p className="mt-2 text-sm text-[var(--danger)]">
            {this.state.error.message || 'Erro desconhecido'}
          </p>
          <button
            type="button"
            className="mt-4 rounded-md bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-[var(--ink)]"
            onClick={() => this.setState({ error: null })}
          >
            Tentar de novo
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
