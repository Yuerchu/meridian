import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DemoBadge } from './demo-badge'

/** A root of its own beside the app's, appended to the body. */
export function mountDemoBadge() {
  const host = document.createElement('div')
  host.setAttribute('data-slot', 'demo-badge-root')
  document.body.appendChild(host)
  createRoot(host).render(
    <StrictMode>
      <DemoBadge />
    </StrictMode>,
  )
}
