import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
import { Button, Modal, SearchField, Spinner, Tooltip } from '@heroui/react'
import { FolderOpen, Xmark } from '@gravity-ui/icons'

import { api } from '@/api'
import { can } from '@/lib/capabilities'
import { HostedAgentGlyph } from '@/components/ui/agent-icon'
import { useRelativeTime } from '@/hooks/use-relative-time'
import type { AcpDiscoveredSessionInfoResponse } from '@/types'

/**
 * How many rows are drawn at once.
 *
 * Not a page size — there is no second page. The list is sorted by recency and
 * the search box is how anything below the cut is reached; what is left over is
 * counted under the list so nobody is looking for a session that is silently
 * not being drawn.
 */
const VISIBLE_LIMIT = 100

/**
 * The Claude Code sessions on this machine, and what to do with one.
 *
 * Two jobs from one list, because it is the same question asked twice:
 *
 * - `import` takes a session over and gives it a conversation here, transcript
 *   and all. This is how a session started in a terminal moves in.
 * - `attach` points a conversation that already exists at a session, writing
 *   nothing but the id. For a conversation from before Meridian recorded them,
 *   which otherwise starts a blank agent under a transcript it cannot see.
 *
 * A dialog rather than a panel in the sidebar: the default scope is every
 * project on the machine, which on a working laptop is dozens of rows that need
 * a search box and enough width for a path.
 *
 * **Sessions Meridian already owns are shown, not hidden.** The adapter cannot
 * be asked to leave them out, and hiding them would make "where did that
 * session go" a question with no answer on screen.
 */
export function ClaudeSessionPicker({
  isOpen,
  onOpenChange,
  mode,
  conversationId,
  onOpenConversation,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  mode: 'import' | 'attach'
  /** The conversation being attached to. Only read in `attach` mode. */
  conversationId?: string | null
  /**
   * Go to a conversation that owns the row that was clicked.
   *
   * The only navigation here. An import does not jump to what it just made —
   * the sidebar gains the row on its own (both operations emit
   * `conversation-updated`), and pulling several in at a sitting is the point
   * of leaving the dialog open.
   */
  onOpenConversation?: (conversationId: string) => void
}) {
  const { t } = useTranslation()
  const relative = useRelativeTime()

  const [sessions, setSessions] = useState<AcpDiscoveredSessionInfoResponse[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  /** The directory the list is narrowed to. Empty means every project. */
  const [folder, setFolder] = useState('')
  /** Which row is being acted on. One at a time: each import starts an adapter
   *  and reads a whole session, and a row that quietly queued behind another
   *  would look like nothing happened. */
  const [busy, setBusy] = useState<string | null>(null)
  const [rowError, setRowError] = useState<{ sessionId: string; message: string } | null>(null)
  /** Sessions that came back as a tail rather than whole. */
  const [truncated, setTruncated] = useState<ReadonlySet<string>>(() => new Set())
  /**
   * Which fetch is the current one.
   *
   * Every load is an adapter start, so two of them are seconds apart and
   * routinely land out of order — narrow to a folder while the whole-machine
   * list is still coming and the wide one arrives last, over the top of the
   * narrow one, under a header still naming the folder. Worse when the first
   * one *failed*: the good list lands and then the stale error covers it, and
   * in a mode with neither the folder button nor the clear button there is
   * nothing left on screen that can ask again.
   */
  const generation = useRef(0)

  const load = useCallback(async (scope: string) => {
    const mine = ++generation.current
    setSessions(null)
    setError(null)
    try {
      const listed = await api.acpListSessions({ cwd: scope.trim() || null })
      if (generation.current !== mine) return
      setSessions(listed)
    } catch (err) {
      if (generation.current !== mine) return
      setError(String(err))
    }
  }, [])

  // Opening in `attach` mode starts from the conversation's own directory: the
  // session it lost is the one that ran there, and the whole-machine list is
  // the wrong place to go looking for it.
  useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    const start = async () => {
      let scope = ''
      if (mode === 'attach' && conversationId) {
        // A conversation with no record falls back to the whole machine, which
        // is the honest answer: nothing here says where to look.
        const record = await api.acpConversationSession(conversationId).catch(() => null)
        scope = record?.cwd ?? ''
      }
      if (cancelled) return
      setQuery('')
      setRowError(null)
      // Reopened, so nothing here is acting on anything. Left over from a
      // previous opening it would be a row stuck at its spinner and, because
      // `act` refuses to start while one is set, a dialog where no row can be
      // clicked at all.
      setBusy(null)
      setFolder(scope)
      await load(scope)
    }
    void start()
    return () => {
      cancelled = true
      // Retires whatever `start` was about to ask for as well as anything
      // already in flight. Reading the ref at cleanup time is the point here,
      // not the hazard the rule is about: this is a counter being advanced, not
      // a node whose identity may have changed since mount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++
    }
  }, [isOpen, mode, conversationId, load])

  const { rows, hidden } = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matching = (sessions ?? []).filter(
      (s) => !needle || (s.title ?? '').toLowerCase().includes(needle) || s.cwd.toLowerCase().includes(needle),
    )
    // Most recently worked on first, and a session with no timestamp last
    // rather than first — an unknown time is not a recent one.
    matching.sort((a, b) => stamp(b.updatedAt) - stamp(a.updatedAt))
    // Measured: 596 sessions on one working laptop, and every one of them is a
    // React Aria Button that re-renders on each keystroke in the search box.
    // Cut to the most recent, with the remainder counted out loud rather than
    // silently dropped — the search is what reaches the rest, and it says so.
    return { rows: matching.slice(0, VISIBLE_LIMIT), hidden: Math.max(0, matching.length - VISIBLE_LIMIT) }
  }, [sessions, query])

  /** Narrow, widen, or try the same scope again. */
  const scopeTo = (scope: string) => {
    setFolder(scope)
    // A row's failure belongs to a row that is about to be replaced. Left
    // behind it reattaches to whichever session lands in that position.
    setRowError(null)
    void load(scope)
  }

  const browse = async () => {
    const selected = await open({ directory: true, multiple: false }).catch(() => null)
    if (typeof selected === 'string') scopeTo(selected)
  }

  const act = async (session: AcpDiscoveredSessionInfoResponse) => {
    if (busy) return
    // The same generation the loads are counted by, read here for a different
    // reason: an attach is a round trip to an adapter, and the user can close
    // this dialog and open it again inside it. The late answer would then close
    // the dialog they had just reopened, and — in `import` mode — revise a list
    // belonging to another scope. Nothing below may touch state without asking.
    const mine = generation.current
    setBusy(session.sessionId)
    setRowError(null)
    try {
      if (mode === 'attach') {
        if (!conversationId) return
        await api.acpAttachSession({ conversationId, sessionId: session.sessionId, cwd: session.cwd })
        if (generation.current !== mine) return
        onOpenChange(false)
      } else {
        const created = await api.acpImportSession({
          sessionId: session.sessionId,
          cwd: session.cwd,
          title: session.title,
          updatedAt: session.updatedAt,
        })
        if (generation.current !== mine) return
        // The row is now owned, so the list has to say so — the dialog stays
        // open because pulling in several at a sitting is the point of it.
        setSessions((current) =>
          (current ?? []).map((s) =>
            s.sessionId === session.sessionId ? { ...s, ownedBy: created.conversationId } : s,
          ),
        )
        // The one thing about this import the user cannot find out anywhere
        // else. Kept on the row rather than shown once and dismissed: it is a
        // fact about that session, and importing five in a row would otherwise
        // scroll it away.
        if (created.truncated) setTruncated((prior) => new Set(prior).add(session.sessionId))
      }
    } catch (err) {
      if (generation.current !== mine) return
      setRowError({ sessionId: session.sessionId, message: String(err) })
    } finally {
      // Only the generation that set it clears it. A newer opening has already
      // reset `busy` above, and clearing it from here would release whichever
      // row that one is working on.
      if (generation.current === mine) setBusy(null)
    }
  }

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Container placement="center">
        <Modal.Dialog data-slot="claude-session-picker" className="sm:max-w-2xl">
          <Modal.Header>
            <Modal.Heading className="flex items-center gap-2">
              <HostedAgentGlyph size={18} />
              {t(mode === 'attach' ? 'sessionPicker.attachHeading' : 'sessionPicker.importHeading')}
            </Modal.Heading>
            <p data-slot="session-picker-hint" className="text-xs text-muted">
              {t(mode === 'attach' ? 'sessionPicker.attachHint' : 'sessionPicker.importHint')}
            </p>
          </Modal.Header>

          {/* `flex flex-col` because `.modal__body` is not one: its `flex-1` is
              an item property, so a bare `gap-3` on it spaces nothing and the
              search box ends up flush against the list. `min-h-0` is what lets
              the list below shrink and scroll inside the dialog rather than
              pushing it taller. */}
          <Modal.Body className="flex min-h-0 flex-col gap-3">
            <div data-slot="session-picker-toolbar" className="flex items-center gap-2">
              {/* HeroUI's own, rather than an Input with an icon stuck on the
                  front: it brings the magnifier, the clear button and Escape
                  clearing the field with it. */}
              <SearchField
                fullWidth
                aria-label={t('sessionPicker.search')}
                value={query}
                onChange={setQuery}
                className="flex-1"
              >
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder={t('sessionPicker.search')} />
                  {/* Named here because HeroUI's `CloseButton` hardcodes
                      `aria-label="Close"` before its spread — untranslated, and
                      wrong about what it does: this clears a field rather than
                      closing anything. */}
                  <SearchField.ClearButton aria-label={t('sessionPicker.clearSearch')} />
                </SearchField.Group>
              </SearchField>
              {/* The adapter runs on the machine the backend is on, so a picker
                  showing this device's folders points at the wrong filesystem —
                  the same split a project's path has. */}
              {can.browseForDirectory && (
                <Button variant="outline" onPress={() => void browse()} className="shrink-0">
                  <FolderOpen />
                  {t('sessionPicker.folder')}
                </Button>
              )}
              {folder && (
                <Tooltip delay={0}>
                  <Button
                    isIconOnly
                    variant="ghost"
                    aria-label={t('sessionPicker.allProjects')}
                    onPress={() => scopeTo('')}
                    className="shrink-0"
                  >
                    <Xmark />
                  </Button>
                  <Tooltip.Content>{t('sessionPicker.allProjects')}</Tooltip.Content>
                </Tooltip>
              )}
            </div>
            {folder && (
              <p data-slot="session-picker-folder" className="truncate text-xs text-muted">
                {folder}
              </p>
            )}

            {/* The live region is the container, not the placeholder inside it.
                Announcing happens when a region that is *already* on the page
                changes; hung on the spinner it would be unmounted at the exact
                moment there was something to say, so "12 sessions" was never
                read out and neither was an empty search. */}
            <div
              data-slot="session-picker-list"
              role="status"
              aria-live="polite"
              aria-busy={sessions === null}
              className="min-h-40 flex-1 overflow-y-auto rounded-lg border"
            >
              {/* The failure is asked about *first*, and that ordering is the
                  whole of whether this state is reachable: a load clears
                  `sessions` on the way in and only sets `error` on the way out,
                  so a spinner branch tested ahead of it wins for ever and a
                  failed list simply spins.

                  With a retry, because the other way back is closing the dialog
                  and reopening it — another adapter start — and in the modes
                  with neither a folder button nor a clear button there is
                  otherwise nothing on screen that can ask again. */}
              {error ? (
                <div data-slot="session-picker-error" className="flex flex-col items-start gap-2 p-4">
                  <p data-slot="session-picker-error-message" role="alert" className="text-xs text-danger">
                    {error}
                  </p>
                  <Button size="sm" variant="outline" onPress={() => void load(folder)}>
                    {t('sessionPicker.retry')}
                  </Button>
                </div>
              ) : sessions === null ? (
                // Starting an adapter takes seconds — on a machine that has
                // never run it, long enough to download the package first.
                <div
                  data-slot="session-picker-loading"
                  className="flex h-40 flex-col items-center justify-center gap-2"
                >
                  <Spinner />
                  <span data-slot="session-picker-loading-label" className="text-xs text-muted">
                    {t('sessionPicker.loading')}
                  </span>
                </div>
              ) : rows.length === 0 ? (
                <p data-slot="session-picker-empty" className="p-4 text-xs text-muted">
                  {t('sessionPicker.empty')}
                </p>
              ) : (
                <ul data-slot="session-picker-rows" aria-label={t('sessionPicker.listLabel')} className="divide-y">
                  {rows.map((session) => (
                    <SessionRow
                      key={session.sessionId}
                      session={session}
                      mode={mode}
                      conversationId={conversationId ?? null}
                      busy={busy === session.sessionId}
                      disabled={busy !== null}
                      error={rowError && rowError.sessionId === session.sessionId ? rowError.message : null}
                      truncated={truncated.has(session.sessionId)}
                      // Through `stamp` rather than straight off the field: an
                      // unreadable timestamp is 0 there, and formatting that
                      // would put 1970 on the row instead of nothing.
                      when={stamp(session.updatedAt) > 0 ? relative(stamp(session.updatedAt)) : null}
                      onAct={() => void act(session)}
                      onOpen={() => {
                        if (!session.ownedBy) return
                        onOpenConversation?.(session.ownedBy)
                        onOpenChange(false)
                      }}
                    />
                  ))}
                  {hidden > 0 && (
                    <li data-slot="session-picker-more" className="px-3 py-2 text-xs text-muted">
                      {t('sessionPicker.more', { count: hidden })}
                    </li>
                  )}
                </ul>
              )}
            </div>
          </Modal.Body>

          <Modal.Footer>
            <Button slot="close" variant="secondary">
              {t('common.close')}
            </Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}

function SessionRow({
  session,
  mode,
  conversationId,
  busy,
  disabled,
  error,
  truncated,
  when,
  onAct,
  onOpen,
}: {
  session: AcpDiscoveredSessionInfoResponse
  mode: 'import' | 'attach'
  conversationId: string | null
  busy: boolean
  disabled: boolean
  error: string | null
  /** This one came back as a tail. Said on the row, not in a toast. */
  truncated: boolean
  when: string | null
  onAct: () => void
  onOpen: () => void
}) {
  const { t } = useTranslation()
  const mine = session.ownedBy !== null && session.ownedBy === conversationId
  const taken = session.ownedBy !== null && !mine

  return (
    // `aria-busy` on the row, not on the button: React Aria filters everything
    // but the labelable aria props off a Button, so it would be dropped there —
    // and the row is what is working anyway.
    <li data-slot="session-row" aria-busy={busy} className="flex items-center gap-3 px-3 py-2">
      <div data-slot="session-row-body" className="min-w-0 flex-1">
        {/* `text-foreground` because `.modal__body` sets `text-muted` on
            everything inside it: inherited, the title came out the same grey as
            the path under it and the two rows of a row read as one.

            An empty title is the same as none: the adapter sanitises whatever
            the SDK summarised, and a row with a blank first line is one nobody
            can tell from its neighbour. */}
        <p data-slot="session-title" className="truncate text-sm text-foreground">
          {session.title?.trim() || leafOf(session.cwd)}
        </p>
        <p data-slot="session-row-path" className="truncate text-xs text-muted">
          {session.cwd}
          {when && ` · ${when}`}
        </p>
        {error && (
          <p data-slot="session-row-error" role="alert" className="mt-1 text-xs text-danger">
            {error}
          </p>
        )}
        {truncated && (
          <p data-slot="session-row-truncated" className="mt-1 text-xs text-warning">
            {t('sessionPicker.truncated')}
          </p>
        )}
      </div>
      {mine ? (
        <span data-slot="session-row-current" className="shrink-0 text-xs text-muted">
          {t('sessionPicker.current')}
        </span>
      ) : taken && mode === 'attach' ? (
        // Two conversations pointing at one session would be two transcripts
        // written from the same place, so the row says why rather than failing
        // when it is pressed.
        <span data-slot="session-row-taken" className="shrink-0 text-xs text-muted">
          {t('sessionPicker.taken')}
        </span>
      ) : taken ? (
        <Button size="sm" variant="ghost" onPress={onOpen} className="shrink-0">
          {t('sessionPicker.alreadyImported')}
        </Button>
      ) : (
        // The label stays while the spinner is up. Swapped for it, the button
        // is both disabled and nameless for the length of an adapter start,
        // which to a screen reader is a control that has stopped existing.
        <Button size="sm" variant="secondary" onPress={onAct} isDisabled={disabled} className="shrink-0">
          {/* Hidden from the accessibility tree: HeroUI's Spinner carries
              `aria-label="Loading"`, which would rename the button to "Loading
              Import" for the length of an adapter start. The row's `aria-busy`
              says the same thing without the control changing its name under
              the reader. */}
          {busy && (
            <span data-slot="session-row-spinner" aria-hidden>
              <Spinner size="sm" />
            </span>
          )}
          {t(mode === 'attach' ? 'sessionPicker.attach' : 'sessionPicker.import')}
        </Button>
      )}
    </li>
  )
}

/** An ISO instant as a number, with an unreadable or absent one sorting last. */
function stamp(iso: string | null): number {
  if (!iso) return 0
  const at = Date.parse(iso)
  return Number.isNaN(at) ? 0 : at
}

function leafOf(cwd: string): string {
  return cwd.split(/[/\\]/).filter(Boolean).pop() ?? cwd
}
