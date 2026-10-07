// Dev-only component gallery. Reachable at #playground from a plain browser
// (vite dev without the Tauri backend) or under `VITE_PLAYGROUND=… pnpm tauri
// dev`; never included in production builds.
//
// This is the design system's showcase as well as the regression bench: every
// page renders the components the product imports, from the same modules, so
// there is no second copy of a component — or of a token — to drift. The
// groups live in `./gallery/`, one page each at `#playground/<group>`.
import { lazy, Suspense, useSyncExternalStore, type ComponentType, type LazyExoticComponent } from 'react'

import { Spinner } from '@/components/base'
import ResponsiveLab, { ResponsiveFrame } from './responsive-lab'
import SchemaLab from './schema-lab'
import ScrollLab from './scroll-lab'
import StickerLab from './sticker-lab'
import WebViewLab from './webview-lab'
import { GROUPS, type GroupId } from './gallery/groups'
import { GalleryFrame, GalleryIndex } from './gallery/shell'

const PAGES: Record<GroupId, LazyExoticComponent<ComponentType>> = {
  foundations: lazy(() => import('./gallery/foundations')),
  core: lazy(() => import('./gallery/core')),
  forms: lazy(() => import('./gallery/forms')),
  overlays: lazy(() => import('./gallery/overlays')),
  navigation: lazy(() => import('./gallery/navigation')),
  feedback: lazy(() => import('./gallery/feedback')),
  data: lazy(() => import('./gallery/data')),
  charts: lazy(() => import('./gallery/charts')),
  chat: lazy(() => import('./gallery/chat')),
  agent: lazy(() => import('./gallery/agent')),
  content: lazy(() => import('./gallery/content')),
}

/**
 * The hash, kept current. A plain browser reloads on every hash change (see
 * `main.tsx`), but a Tauri window does not, and the group strip's links would
 * otherwise change the address and nothing else there.
 */
function useHash(): string {
  return useSyncExternalStore(
    (notify) => {
      window.addEventListener('hashchange', notify)
      return () => window.removeEventListener('hashchange', notify)
    },
    () => window.location.hash,
  )
}

export default function Playground() {
  const hash = useHash()
  // Sub-views get their own hash rather than a section in the gallery: the
  // scroll harness needs the full viewport height, which a page that scrolls as
  // a whole cannot give it.
  if (hash === '#playground/scroll') return <ScrollLab />
  if (hash === '#playground/webview') return <WebViewLab />
  if (hash === '#playground/schema') return <SchemaLab />
  if (hash === '#playground/stickers') return <StickerLab legacy={false} />
  if (hash === '#playground/stickers-legacy') return <StickerLab legacy />
  // One route, two sides: the harness and the frame it drives are the same
  // document loaded twice, told apart by a query parameter rather than a second
  // hash — the checks above are `===`, and a frame carrying its own hash suffix
  // would have to loosen all of them.
  if (hash === '#playground/responsive') {
    const isFrame = new URLSearchParams(window.location.search).has('responsiveCase')
    return isFrame ? <ResponsiveFrame /> : <ResponsiveLab />
  }
  const group = GROUPS.find((g) => hash === `#playground/${g.id}`)
  if (!group) return <GalleryIndex />
  const Page = PAGES[group.id]
  return (
    <GalleryFrame current={group.id} wide={group.id === 'foundations'}>
      <Suspense fallback={<Spinner aria-label="加载中" />}>
        <Page />
      </Suspense>
    </GalleryFrame>
  )
}
