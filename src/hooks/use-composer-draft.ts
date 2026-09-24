import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { AttachedFile, PendingSticker } from '@/components/chat/input-bar'
import {
  draftKey,
  EMPTY_PERSISTED_DRAFT,
  isEmptyDraft,
  isPersistablePath,
  loadComposerDraft,
  persistedFromResponse,
  writeComposerDraft,
  type PersistedComposerDraft,
} from '@/lib/composer-draft-sync'
import { loadStickerUrl } from '@/lib/sticker-urls'
import type { ComposerDraftInfoResponse } from '@/types'

/**
 * How long typing has to pause before the draft is written.
 *
 * Keys arrive 100–300ms apart in a burst, so 600ms folds a burst into one
 * write while a pause at the end of a phrase is on disk in well under a
 * second — which bounds what a crash can take to the last fraction of a
 * sentence. Each write is one upsert of one row; the debounce is mostly about
 * not sending an IPC call and a WAL commit per keystroke.
 */
export const COMPOSER_DRAFT_DEBOUNCE_MS = 600

/** A conversation dragged in as a reference; `missing` once it was deleted. */
export interface ComposerConversationRef {
  id: string
  title: string
  missing?: boolean
}

/** Everything a composer holds that a draft is made of. */
export interface ComposerDraftState {
  text: string
  attachedFiles: AttachedFile[]
  pendingSticker: PendingSticker | null
  conversationRefs: ComposerConversationRef[]
}

function persistedOf(state: ComposerDraftState): PersistedComposerDraft {
  return {
    body: state.text,
    // Only what could be opened again after a restart. A `File` or a
    // `content://` grant dies with the page, so it is not written and does
    // not come back — rather than coming back as a chip that cannot be sent.
    attachments: state.attachedFiles.flatMap((file) =>
      !file.file && file.path && isPersistablePath(file.path) ? [{ path: file.path, name: file.name }] : [],
    ),
    conversationRefs: state.conversationRefs.map((ref) => ref.id),
    stickerId: state.pendingSticker?.emoji.id ?? null,
  }
}

async function stateFromResponse(row: ComposerDraftInfoResponse): Promise<ComposerDraftState> {
  const sticker = row.sticker
  return {
    text: row.body,
    attachedFiles: row.attachments.map((a) => ({
      path: a.path,
      name: a.name,
      ...(a.exists ? {} : { missing: true }),
    })),
    pendingSticker: sticker ? { emoji: sticker, url: await loadStickerUrl(sticker.id).catch(() => '') } : null,
    conversationRefs: row.conversation_refs.map((ref) => ({
      id: ref.id,
      title: ref.title ?? '',
      ...(ref.exists ? {} : { missing: true }),
    })),
  }
}

export interface ComposerDraftControls {
  /** The last write failed. Cleared by the next write that succeeds. */
  saveError: string | null
  /** Write a pending change now instead of when the debounce fires. */
  flush: () => void
  /**
   * Forget the stored draft without the composer's state having changed —
   * for a composer that is about to disappear because what it held became a
   * conversation. Anything typed afterwards is written as usual.
   */
  clear: () => void
}

/**
 * Keep one composer's draft in the database.
 *
 * On mount the stored draft is read and handed to `onRestore`. Until that
 * read has finished nothing is written: the composer starts empty, and an
 * empty composer written back first would delete the draft it was about to
 * show. If somebody typed before the read came back, what they typed wins and
 * the stored draft is not restored over it.
 *
 * After that, a change is written once typing pauses, and immediately when the
 * text is emptied — which is what every send path does, so a crash a moment
 * after sending cannot bring the sent text back as a draft. A pending write is
 * flushed when the page is hidden or unloaded and when the composer unmounts
 * (switching conversation remounts it). A failed write is reported through
 * `saveError` and retried by the next change.
 */
export function useComposerDraft(
  conversationId: string | null,
  state: ComposerDraftState,
  onRestore: (restored: ComposerDraftState) => void,
): ComposerDraftControls {
  const [saveError, setSaveError] = useState<string | null>(null)

  const { text, attachedFiles, pendingSticker, conversationRefs } = state
  const persisted = useMemo(
    () => persistedOf({ text, attachedFiles, pendingSticker, conversationRefs }),
    [text, attachedFiles, pendingSticker, conversationRefs],
  )
  const key = useMemo(() => draftKey(persisted), [persisted])

  const latest = useRef({ persisted, key })
  const onRestoreRef = useRef(onRestore)
  // Before any other effect of this render reads them.
  useLayoutEffect(() => {
    latest.current = { persisted, key }
    onRestoreRef.current = onRestore
  })

  /** Whether the stored draft has been read. Nothing is written before. */
  const loaded = useRef(false)
  /** What the database holds, as far as this composer knows; `null` until read. */
  const storedKey = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(false)
  const previousBody = useRef(text)

  const write = useCallback(
    (draft: PersistedComposerDraft) => {
      const written = draftKey(draft)
      writeComposerDraft(conversationId, draft).then(
        (response) => {
          if (!response.applied) throw new Error('the draft was changed elsewhere at the same time')
          storedKey.current = written
          if (mounted.current) setSaveError(null)
        },
        (error: unknown) => {
          // Left unrecorded as stored, so the next change writes it again.
          if (mounted.current) setSaveError(String(error))
          else console.error('Failed to save composer draft', error)
        },
      )
    },
    [conversationId],
  )

  const cancelTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const flush = useCallback(() => {
    if (timer.current === null) return
    cancelTimer()
    write(latest.current.persisted)
  }, [cancelTimer, write])

  const clear = useCallback(() => {
    cancelTimer()
    storedKey.current = latest.current.key
    write(EMPTY_PERSISTED_DRAFT)
  }, [cancelTimer, write])

  // Read the stored draft once per composer.
  useEffect(() => {
    mounted.current = true
    loaded.current = false
    let cancelled = false
    const initialKey = latest.current.key
    loadComposerDraft(conversationId)
      .then(async (row) => {
        const restored = row ? await stateFromResponse(row) : null
        if (cancelled) return
        storedKey.current = draftKey(persistedFromResponse(row))
        // Only into a composer nobody has touched yet: text typed while the
        // read was in flight is newer than anything stored.
        if (restored && latest.current.key === initialKey) {
          onRestoreRef.current(restored)
          latest.current = { persisted: persistedFromResponse(row), key: storedKey.current }
        }
        loaded.current = true
        if (latest.current.key !== storedKey.current) write(latest.current.persisted)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        // What is stored is unknown. Treat the composer as it stands as stored,
        // so an untouched composer writes nothing over a draft it could not
        // see; typing afterwards is newer and is written.
        storedKey.current = latest.current.key
        loaded.current = true
        setSaveError(String(error))
      })
    return () => {
      cancelled = true
      mounted.current = false
      // Switching conversation unmounts the composer: whatever was waiting
      // for the debounce goes now.
      if (timer.current !== null && loaded.current) {
        clearTimeout(timer.current)
        timer.current = null
        write(latest.current.persisted)
      }
    }
  }, [conversationId, write])

  // Write on change.
  useEffect(() => {
    const emptied = previousBody.current !== '' && persisted.body === ''
    previousBody.current = persisted.body
    if (!loaded.current) return
    if (key === storedKey.current) {
      cancelTimer()
      return
    }
    cancelTimer()
    if (emptied || isEmptyDraft(persisted)) {
      write(persisted)
      return
    }
    timer.current = setTimeout(() => {
      timer.current = null
      write(latest.current.persisted)
    }, COMPOSER_DRAFT_DEBOUNCE_MS)
  }, [key, persisted, cancelTimer, write])

  // The page going away is the crash we can see coming.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [flush])

  return { saveError, flush, clear }
}
