import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/error-boundary'
import './i18n'
import './index.css'

createRoot(document.getElementById('root')!).render(
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
