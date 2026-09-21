import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useConfirm } from '@/hooks/use-confirm'
import { useHistoryLevel } from '@/hooks/use-history-level'
import { useHotkey } from '@/hooks/use-hotkey'
import { useTranslation } from 'react-i18next'
import { cx } from '@/utils/cx'
import { useSettingsDirtyRegistration } from './dirty-guard'
import type { SettingsTab } from './tabs'

/**
 * One thing at a time, with a way back.
 *
 * A settings panel used to put its list beside its detail on a desktop and one
 * behind the other on a phone, which is two layouts, two sets of state to keep
 * honest, and a threshold to argue about. Here there is one: pages on a stack.
 * The list is a page, the provider you opened is a page, the model's prices are
 * a page, and every width gets the same three.
 *
 * ```tsx
 * const stack = useSettingsStack<ProviderLevel>()
 * <SettingsStack stack={stack}>
 *   {(level) => (level === null ? <ListPage … /> : <DetailPage … />)}
 * </SettingsStack>
 * ```
 *
 * **Every level stays mounted; only the top is visible.** Indistinguishable on
 * screen from rendering the top alone, and it buys three things: a draft two
 * levels down survives a trip into a sub-page, its dirty registration stays
 * registered so the shell keeps refusing to leave settings, and there is one
 * scroller rather than one per page. The cost is that a hidden page's effects
 * keep running, which is what the portal-based drilldown this replaces already
 * did.
 */

/** Which page a component is on. Zero is the root, and zero outside a stack. */
const SettingsLevelContext = createContext(0)

interface StackInternals {
  markDirty: (index: number, source: string, dirty: boolean) => void
  pop: () => Promise<boolean>
  depth: number
}

const SettingsStackContext = createContext<StackInternals | null>(null)

export interface SettingsStack<L> {
  readonly levels: readonly L[]
  /** `null` at the root. */
  readonly top: L | null
  /** `levels.length`. The root is page 0 and `levels[i]` is page `i + 1`. */
  readonly depth: number
  /**
   * Opens a page over this one. Never asks: the page beneath stays mounted, so
   * nothing is being discarded.
   */
  push: (level: L) => void
  /** Swaps the top page. Asks if that page has unsaved work. */
  replace: (level: L) => Promise<boolean>
  /** Back one page. Asks if anything above the destination has unsaved work. */
  pop: () => Promise<boolean>
  /** Back to `depth`. Asks once, however many pages that unwinds. */
  popTo: (depth: number) => Promise<boolean>
  /**
   * Unwinds without asking — for after a delete, when the draft is about a row
   * that no longer exists and the question would be about nothing.
   */
  reset: (depth?: number) => void
  /** The stack's own dialog, lent out so a panel needs only one. */
  confirm: ReturnType<typeof useConfirm>['confirm']
  /** @internal consumed by `<SettingsStack>`. */
  readonly _internal: {
    dialog: React.ReactNode
    internals: StackInternals
    unclaimed: number | null
    onHistoryBack: (index: number) => void
    generation: number
  }
}

export function useSettingsStack<L>(): SettingsStack<L> {
  const { t } = useTranslation()
  const { confirm, confirmDialog } = useConfirm()
  const [levels, setLevels] = useState<L[]>([])
  // Bumped on every move, so a `replace` at an unchanged depth still scrolls to
  // the top and moves focus.
  const [generation, setGeneration] = useState(0)
  const [unclaimed, setUnclaimed] = useState<number | null>(null)
  // Not state: read inside callbacks that would otherwise need it as a
  // dependency, and written from an effect on every page that has a draft.
  const dirtyByLevel = useRef(new Map<number, Set<string>>())

  const markDirty = useCallback((index: number, source: string, dirty: boolean) => {
    const sources = dirtyByLevel.current.get(index) ?? new Set<string>()
    if (dirty) sources.add(source)
    else sources.delete(source)
    if (sources.size === 0) dirtyByLevel.current.delete(index)
    else dirtyByLevel.current.set(index, sources)
  }, [])

  /**
   * Asks only about the pages actually being discarded.
   *
   * Popping a clean sub-page back onto a dirty parent must not ask: the parent
   * is still mounted and still holding its draft, so nothing is lost. Only what
   * is above `target` is going away.
   */
  const mayDiscardAbove = useCallback(
    async (target: number): Promise<boolean> => {
      let dirty = false
      for (const [index, sources] of dirtyByLevel.current) {
        if (index > target && sources.size > 0) dirty = true
      }
      if (!dirty) return true
      return confirm({ body: t('settings.unsavedChanges'), status: 'warning' })
    },
    [confirm, t],
  )

  const forget = useCallback((from: number) => {
    for (const index of [...dirtyByLevel.current.keys()]) {
      if (index > from) dirtyByLevel.current.delete(index)
    }
  }, [])

  const push = useCallback((level: L) => {
    setLevels((current) => [...current, level])
    setGeneration((n) => n + 1)
  }, [])

  // The question is asked *before* the pages go: asked after, a refusal would
  // leave the reader looking at the list while being asked about a draft they
  // can no longer see.
  const guardedPopTo = useCallback(
    async (target: number): Promise<boolean> => {
      const clamped = Math.max(0, target)
      if (levels.length <= clamped) return true
      if (!(await mayDiscardAbove(clamped))) return false
      forget(clamped)
      setLevels((current) => current.slice(0, clamped))
      setGeneration((n) => n + 1)
      return true
    },
    [forget, levels.length, mayDiscardAbove],
  )

  const pop = useCallback(() => guardedPopTo(levels.length - 1), [guardedPopTo, levels.length])

  const replace = useCallback(
    async (level: L): Promise<boolean> => {
      if (levels.length === 0) {
        push(level)
        return true
      }
      if (!(await mayDiscardAbove(levels.length - 1))) return false
      forget(levels.length - 1)
      setLevels((current) => [...current.slice(0, -1), level])
      setGeneration((n) => n + 1)
      return true
    },
    [forget, levels.length, mayDiscardAbove, push],
  )

  const reset = useCallback(
    (target = 0) => {
      const clamped = Math.max(0, target)
      forget(clamped)
      setLevels((current) => (current.length > clamped ? current.slice(0, clamped) : current))
      setGeneration((n) => n + 1)
    },
    [forget],
  )

  /**
   * The back gesture, and the dance a refusal needs.
   *
   * `settleTo` retires a level *before* calling its dismiss, so a page that
   * says "ask first" and is then told to stay would be left with no history
   * entry and the next press would leave settings entirely. Dropping the claim
   * and restoring it on the next frame is a fresh false-to-true edge, which is
   * the only thing `useHistoryLevel` re-registers on.
   */
  const onHistoryBack = useCallback(
    (index: number) => {
      setUnclaimed(index)
      void guardedPopTo(index).then((closed) => {
        if (!closed) requestAnimationFrame(() => setUnclaimed(null))
        else setUnclaimed(null)
      })
    },
    [guardedPopTo],
  )

  const internals = useMemo<StackInternals>(
    () => ({ markDirty, pop, depth: levels.length }),
    [markDirty, pop, levels.length],
  )

  return useMemo(
    () => ({
      levels,
      top: levels.length > 0 ? levels[levels.length - 1] : null,
      depth: levels.length,
      push,
      replace,
      pop,
      popTo: guardedPopTo,
      reset,
      confirm,
      _internal: { dialog: confirmDialog, internals, unclaimed, onHistoryBack, generation },
    }),
    [
      levels,
      push,
      replace,
      pop,
      guardedPopTo,
      reset,
      confirm,
      confirmDialog,
      internals,
      unclaimed,
      onHistoryBack,
      generation,
    ],
  )
}

/** One `useHistoryLevel` per page above the root. Hooks cannot go in a loop. */
function HistoryClaim({ isOpen, onBack }: { isOpen: boolean; onBack: () => void }) {
  useHistoryLevel(isOpen, onBack)
  return null
}

export function SettingsStack<L>({
  stack,
  className,
  children,
}: {
  stack: SettingsStack<L>
  className?: string
  children: (level: L | null, index: number) => React.ReactNode
}) {
  const { levels, depth, _internal } = stack
  const [root, setRoot] = useState<HTMLElement | null>(null)
  useLevelScroll(root, depth, _internal.generation)
  useLevelFocus(root, depth, _internal.generation)

  /**
   * Escape goes back one page on a desktop, where there is no back gesture.
   *
   * Skipped while the pointer is inside a dialog: React Aria's own overlays
   * handle Escape and stop it, but the non-dismissable ones do not, and a press
   * meant for the question would otherwise pop the page underneath it as well.
   */
  useHotkey(
    'escape',
    (event) => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('[role="dialog"], [role="alertdialog"]')) return
      void stack.pop()
    },
    { enabled: depth > 0 },
  )

  return (
    <div data-slot="settings-stack" ref={setRoot} className={cx('w-full', className)}>
      {levels.map((_, index) => (
        <HistoryClaim
          key={index}
          isOpen={_internal.unclaimed !== index}
          onBack={() => _internal.onHistoryBack(index)}
        />
      ))}
      <SettingsStackContext.Provider value={_internal.internals}>
        {[null as L | null, ...levels].map((level, index) => (
          <div
            key={index}
            data-slot="settings-level"
            data-index={index}
            hidden={index !== depth}
            inert={index !== depth ? true : undefined}
          >
            <SettingsLevelContext.Provider value={index}>{children(level, index)}</SettingsLevelContext.Provider>
          </div>
        ))}
      </SettingsStackContext.Provider>
      {_internal.dialog}
    </div>
  )
}

/**
 * Registers a draft with the shell's tab guard *and* with the page it is on.
 *
 * Two readers, two questions. The shell asks "may we leave settings", which is
 * about the tab; the stack asks "may this page go", which is about one level.
 * A panel outside a stack gets the first alone, which is what it had before.
 */
export function useSettingsDraft(tab: SettingsTab, source: string, dirty: boolean): void {
  useSettingsDirtyRegistration(tab, source, dirty)
  const index = useContext(SettingsLevelContext)
  const stack = useContext(SettingsStackContext)
  useLayoutEffect(() => {
    stack?.markDirty(index, source, dirty)
    return () => stack?.markDirty(index, source, false)
  }, [stack, index, source, dirty])
}

/** What a page needs to know about where it sits. */
export function useSettingsLevel(): { index: number; pop: () => Promise<boolean> } {
  const index = useContext(SettingsLevelContext)
  const stack = useContext(SettingsStackContext)
  const pop = useCallback(() => stack?.pop() ?? Promise.resolve(false), [stack])
  return { index, pop }
}

/**
 * Each page keeps its own scroll position, and the reader comes back to it.
 *
 * Every page shares the settings scroller, so without this a detail opens
 * halfway down because that is where the list was, and the list comes back at
 * whatever offset the detail left behind.
 */
function useLevelScroll(root: HTMLElement | null, depth: number, generation: number) {
  const saved = useRef<number[]>([])
  const previous = useRef({ depth, generation })

  useLayoutEffect(() => {
    const was = previous.current
    if (was.generation === generation) return
    previous.current = { depth, generation }
    const scroller = root?.closest<HTMLElement>('[data-slot="settings-scroller"]')
    if (!scroller) return

    if (depth > was.depth) {
      saved.current[was.depth] = scroller.scrollTop
      scroller.scrollTop = 0
      return
    }
    if (depth === was.depth) {
      scroller.scrollTop = 0
      return
    }
    // Going back: the page underneath is on screen but has not been measured
    // yet, so assigning now would be clamped against the shorter page's height.
    // One frame later it is its own.
    const frame = requestAnimationFrame(() => {
      scroller.scrollTop = saved.current[depth] ?? 0
    })
    return () => cancelAnimationFrame(frame)
  }, [root, depth, generation])
}

/** Focus follows the navigation, and returns to the row that started it. */
function useLevelFocus(root: HTMLElement | null, depth: number, generation: number) {
  const returnKeys = useRef<Array<string | null>>([])
  const previous = useRef({ depth, generation })

  useLayoutEffect(() => {
    const was = previous.current
    if (was.generation === generation) return
    previous.current = { depth, generation }
    if (!root) return

    if (depth >= was.depth) {
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
      returnKeys.current[was.depth] = active?.closest<HTMLElement>('[data-key]')?.dataset.key ?? null
    }
    const frame = requestAnimationFrame(() => {
      const visible = root.querySelector<HTMLElement>('[data-slot="settings-level"]:not([hidden])')
      if (!visible) return
      if (depth < was.depth) {
        const key = returnKeys.current[depth]
        const row = key
          ? Array.from(visible.querySelectorAll<HTMLElement>('[data-key]')).find(
              (candidate) => candidate.dataset.key === key,
            )
          : null
        if (row) {
          row.focus()
          return
        }
      }
      const heading = visible.querySelector<HTMLElement>('h2')
      if (heading) {
        heading.tabIndex = -1
        heading.focus()
        return
      }
      visible.querySelector<HTMLElement>('[data-slot="settings-page-back"]')?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [root, depth, generation])
}
