import React from 'react'

interface ErrorBoundaryProps {
  fallback: React.ReactNode | ((error: Error) => React.ReactNode)
  children: React.ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  render() {
    if (this.state.error) {
      const { fallback } = this.props
      return typeof fallback === 'function' ? fallback(this.state.error) : fallback
    }
    return this.props.children
  }
}
