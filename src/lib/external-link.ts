import { open } from '@tauri-apps/plugin-shell'

import { classifyMarkdownTarget } from './markdown-target'

export function normalizeExternalUrl(href: string | undefined): string | null {
  const target = classifyMarkdownTarget(href)
  return target.kind === 'external' ? target.url : null
}

export async function openExternalUrl(href: string | undefined): Promise<boolean> {
  const url = normalizeExternalUrl(href)
  if (!url) return false
  try {
    await open(url)
  } catch {
    // Vite's browser preview has no Tauri shell plugin. It may use the browser
    // fallback; a Tauri WebView must not. `window.open` there can create or
    // navigate another WebView, recreating the crash this function exists to
    // prevent when the native opener rejects a malformed/platform-blocked URL.
    if (!('__TAURI_INTERNALS__' in window)) {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }
  return true
}

/**
 * Opens a link in the user's browser instead of in the app.
 *
 * This is a WebView: an ordinary anchor navigates the application itself to the
 * page, with no address bar and no way back. `target="_blank"` does not save it
 * either — there is no second tab to open into.
 *
 * Returns whether it took the click, so a caller can leave anything that is not
 * a web address alone.
 */
export function openExternally(href: string | undefined, event: { preventDefault: () => void }): boolean {
  // Every caller renders in a WebView. Even an unsupported or malformed URL
  // must be consumed; native navigation is never a safe fallback for model
  // output.
  event.preventDefault()
  const url = normalizeExternalUrl(href)
  if (!url) return false
  void openExternalUrl(url)
  return true
}
