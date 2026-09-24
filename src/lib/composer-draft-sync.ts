import { api } from '@/api'
import type { ComposerDraftAttachmentRequest, ComposerDraftInfoResponse, ComposerDraftWriteResponse } from '@/types'

/**
 * The part of a composer that is written to the database.
 *
 * Deliberately narrower than what the composer holds: an attachment carried
 * as a browser `File` (a drop, or a remote client's picker) or as an Android
 * `content://` grant cannot be opened again after the page is gone, so it is
 * not offered to the host at all. What is left compares by value, which is
 * what decides whether anything needs writing.
 */
export interface PersistedComposerDraft {
  body: string
  attachments: ComposerDraftAttachmentRequest[]
  conversationRefs: string[]
  stickerId: string | null
}

export const EMPTY_PERSISTED_DRAFT: PersistedComposerDraft = {
  body: '',
  attachments: [],
  conversationRefs: [],
  stickerId: null,
}

/** A path this host can open again after a restart: absolute, not a URI. */
export function isPersistablePath(path: string): boolean {
  return /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(path)
}

export function isEmptyDraft(draft: PersistedComposerDraft): boolean {
  return (
    draft.body === '' &&
    draft.attachments.length === 0 &&
    draft.conversationRefs.length === 0 &&
    draft.stickerId === null
  )
}

export function draftKey(draft: PersistedComposerDraft): string {
  return JSON.stringify([draft.body, draft.attachments, draft.conversationRefs, draft.stickerId])
}

export function persistedFromResponse(row: ComposerDraftInfoResponse | null): PersistedComposerDraft {
  if (!row) return EMPTY_PERSISTED_DRAFT
  return {
    body: row.body,
    attachments: row.attachments.map(({ path, name }) => ({ path, name })),
    conversationRefs: row.conversation_refs.map((ref) => ref.id),
    stickerId: row.sticker?.id ?? null,
  }
}

const slotOf = (conversationId: string | null) => conversationId ?? '\u0000new'

/**
 * Every write for one composer goes through one chain, so this window never
 * has two in flight for the same slot. Tauri runs async commands concurrently,
 * and a debounced save followed quickly by a flush would otherwise be two
 * invokes the runtime is free to finish in either order. The chain is also
 * what a remount waits on before reading: leaving a conversation flushes, and
 * coming straight back must read what that flush wrote rather than race it.
 */
const chains = new Map<string, Promise<unknown>>()

/**
 * The highest revision this window has used or seen, per slot. It outlives the
 * component so a remount continues above the flush the unmount sent. The
 * database is the arbiter: a write that is not above what is stored changes
 * nothing and says which revision beat it.
 */
const revisions = new Map<string, number>()

function noteRevision(slot: string, revision: number) {
  revisions.set(slot, Math.max(revisions.get(slot) ?? 0, revision))
}

function nextRevision(slot: string): number {
  const next = (revisions.get(slot) ?? 0) + 1
  revisions.set(slot, next)
  return next
}

function enqueue<T>(slot: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(slot) ?? Promise.resolve()
  const run = previous.then(task, task)
  const settled = run.catch(() => undefined)
  chains.set(slot, settled)
  void settled.then(() => {
    if (chains.get(slot) === settled) chains.delete(slot)
  })
  return run
}

/** The stored draft, read after every write this window has already sent. */
export async function loadComposerDraft(conversationId: string | null): Promise<ComposerDraftInfoResponse | null> {
  const slot = slotOf(conversationId)
  await (chains.get(slot) ?? Promise.resolve())
  const row = await api.getComposerDraft({ conversationId })
  if (row) noteRevision(slot, row.revision)
  return row
}

async function writeOnce(
  conversationId: string | null,
  draft: PersistedComposerDraft,
  revision: number,
): Promise<ComposerDraftWriteResponse> {
  if (isEmptyDraft(draft)) return api.clearComposerDraft({ conversationId, revision })
  return api.saveComposerDraft({
    conversationId,
    body: draft.body,
    attachments: draft.attachments,
    conversationRefs: draft.conversationRefs,
    stickerId: draft.stickerId,
    revision,
  })
}

/**
 * Store what the composer holds; an empty draft removes the row.
 *
 * A refusal means a newer revision is stored — another window or device wrote
 * this draft since this one last read it. Within one window the chain rules
 * that out, so what is being typed here, now, is the most recent intent there
 * is: the write is retried once above the winner rather than dropped.
 */
export function writeComposerDraft(
  conversationId: string | null,
  draft: PersistedComposerDraft,
): Promise<ComposerDraftWriteResponse> {
  const slot = slotOf(conversationId)
  return enqueue(slot, async () => {
    let response = await writeOnce(conversationId, draft, nextRevision(slot))
    if (!response.applied) {
      noteRevision(slot, response.revision)
      response = await writeOnce(conversationId, draft, nextRevision(slot))
    }
    noteRevision(slot, response.revision)
    return response
  })
}

/** Test seam: forget every slot's chain and revision. */
export function resetComposerDraftSync() {
  chains.clear()
  revisions.clear()
}
