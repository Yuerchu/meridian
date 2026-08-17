import { useEffect, useEffectEvent } from 'react'

/**
 * One global keyboard shortcut, bound for as long as the component lives.
 *
 * Not a registry, and deliberately so. The app has exactly one global shortcut
 * of its own today; a registry with scopes and sequences would be paying for a
 * second one that has not been asked for. If a third arrives and they start
 * colliding, *then* build the thing that resolves collisions.
 *
 * `mod` matches either Command or Control rather than picking one from the user
 * agent. Sniffing the platform for this is guesswork — a Mac keyboard on a
 * Windows machine is not exotic — and accepting both is what Pro's own
 * `Sidebar.Provider` does for `mod+b`, which is the only other shortcut in the
 * app. Two shortcuts that disagree about what `mod` means would be worse than
 * either answer.
 */
export interface Hotkey {
  key: string
  /** Command *or* Control. */
  mod: boolean
  ctrl: boolean
  meta: boolean
  shift: boolean
  alt: boolean
}

/** `null` for a combo with no key in it, which is a typo rather than a state. */
export function parseHotkey(combo: string): Hotkey | null {
  const spec: Hotkey = { key: '', mod: false, ctrl: false, meta: false, shift: false, alt: false }

  for (const raw of combo.split('+')) {
    const part = raw.trim().toLowerCase()
    if (!part) continue
    if (part === 'mod') spec.mod = true
    else if (part === 'ctrl' || part === 'control') spec.ctrl = true
    else if (part === 'cmd' || part === 'command' || part === 'meta' || part === 'super') spec.meta = true
    else if (part === 'shift') spec.shift = true
    else if (part === 'alt' || part === 'option' || part === 'opt') spec.alt = true
    else spec.key = part
  }

  return spec.key ? spec : null
}

export function matchesHotkey(event: KeyboardEvent, spec: Hotkey): boolean {
  if (event.key.toLowerCase() !== spec.key) return false
  if (event.shiftKey !== spec.shift || event.altKey !== spec.alt) return false
  if (spec.mod) return event.metaKey || event.ctrlKey
  return event.ctrlKey === spec.ctrl && event.metaKey === spec.meta
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export interface HotkeyOptions {
  /** Unbinds without unmounting the caller. @default true */
  enabled?: boolean
  /**
   * Let the field have the key when a field has focus. @default true
   *
   * The one shortcut that wants `false` is the command palette: wanting to jump
   * somewhere else in the middle of typing is *the* moment it exists for.
   * Everything else would be stealing a key from a text field, which is how a
   * shortcut turns into a bug report about the composer.
   */
  ignoreInInput?: boolean
}

/**
 * Calls `handler` when `combo` is pressed anywhere in the window.
 *
 * The event's default is prevented on a match, because every combo worth
 * binding is one the browser or the WebView already has an opinion about.
 */
export function useHotkey(combo: string, handler: (event: KeyboardEvent) => void, options: HotkeyOptions = {}): void {
  const { enabled = true, ignoreInInput = true } = options
  // An inline handler must stay fresh without rebinding the listener on every
  // render of the component that owns it.
  const current = useEffectEvent(handler)

  useEffect(() => {
    if (!enabled) return
    const spec = parseHotkey(combo)
    if (!spec) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesHotkey(event, spec)) return
      if (ignoreInInput && isTyping(event.target)) return
      event.preventDefault()
      current(event)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [combo, enabled, ignoreInInput])
}
