import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'motion/react'
import App from './App'
import { ErrorBoundary } from './components/error-boundary'
import { ThemeProvider } from './lib/theme'
import './i18n'
import './index.css'

const root = createRoot(document.getElementById('root')!)

const isDev = import.meta.env.DEV
const isBrowserDev = isDev && !('__TAURI_INTERNALS__' in window)

// A Tauri window has no address bar, so `VITE_PLAYGROUND=heroui pnpm tauri dev`
// is the only way in. Written with replaceState rather than by assigning the
// hash, which would fire the reload listener below and loop.
const wantedPlayground = isDev ? import.meta.env.VITE_PLAYGROUND : undefined
if (wantedPlayground && !window.location.hash.startsWith('#playground')) {
  const route = wantedPlayground === 'true' ? '#playground' : `#playground/${wantedPlayground}`
  window.history.replaceState(null, '', route)
}

// Browser only: the address bar is the sole way to switch playground routes
// there, and nothing picks up a hash change on its own. Under Tauri the hash is
// set once at startup and never edited by hand, so the same listener would only
// reload the whole app whenever someone clicks an `#anchor` in a message.
if (isBrowserDev) {
  window.addEventListener('hashchange', () => window.location.reload())
}

// Dev-only component playground; the dynamic import below is dead code in
// production builds, so the chunk is never emitted. `#playground/…` selects a
// sub-view — see `dev/playground.tsx`.
//
// Reachable under Tauri as well as from a plain browser. It began as
// browser-only, but the differences worth catching in a preview are the ones
// the browser does not have: WebView2 has its own opinions about what it will
// render, and it has crashed on CSS the browser was happy with.
if (isDev && window.location.hash.startsWith('#playground')) {
  import('./dev/playground').then(({ default: Playground }) => {
    root.render(
      <StrictMode>
        <ThemeProvider>
          <MotionConfig reducedMotion="user">
            <Playground />
          </MotionConfig>
        </ThemeProvider>
      </StrictMode>,
    )
  })
} else {
  root.render(
    <StrictMode>
      <ThemeProvider>
        <MotionConfig reducedMotion="user">
          <ErrorBoundary
            fallback={(error) => (
              <div className="flex h-screen flex-col items-center justify-center gap-2 p-8 text-center">
                <p className="text-sm font-medium">Something went wrong</p>
                <p className="text-xs text-muted break-all max-w-md">{String(error)}</p>
              </div>
            )}
          >
            <App />
          </ErrorBoundary>
        </MotionConfig>
      </ThemeProvider>
    </StrictMode>,
  )
}
