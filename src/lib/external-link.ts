import { open } from '@tauri-apps/plugin-shell'

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
  if (!href || !/^https?:/i.test(href)) return false
  event.preventDefault()
  // Failure is silent by design: the alternative is an error dialog for a
  // mis-typed link in someone else's text.
  void open(href).catch(() => {})
  return true
}
