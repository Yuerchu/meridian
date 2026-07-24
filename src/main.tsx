import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/error-boundary'
import './i18n'
import './index.css'

const root = createRoot(document.getElementById('root')!)

const isBrowserDev = import.meta.env.DEV && !('__TAURI_INTERNALS__' in window)
if (isBrowserDev) {
  window.addEventListener('hashchange', () => window.location.reload())
}

// Dev-only component playground; the dynamic import below is dead code in
// production builds, so the chunk is never emitted.
if (isBrowserDev && window.location.hash === '#playground') {
  import('./dev/playground').then(({ default: Playground }) => {
    root.render(
      <StrictMode>
        <Playground />
      </StrictMode>,
    )
  })
} else {
  root.render(
    <StrictMode>
      <ErrorBoundary
        fallback={(error) => (
          <div className="flex h-screen flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-sm font-medium">Something went wrong</p>
            <p className="text-xs text-muted-foreground break-all max-w-md">{String(error)}</p>
          </div>
        )}
      >
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}
