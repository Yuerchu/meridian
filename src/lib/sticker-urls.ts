import { useEffect, useState } from 'react'
import { api } from '@/api'

/**
 * Where a sticker's picture is, asked for one at a time and remembered.
 *
 * `get_emoji_file_url` answers a local sticker with its whole file as a
 * `data:` URL, so one answer can be a megabyte of base64 crossing IPC. Every
 * surface used to ask for every sticker it *might* show the moment it mounted
 * — the picker for every assigned pack, the settings page for every pack, the
 * chat for every sticker an assistant could name — which is what made opening
 * any of them slow and kept all of it in memory for as long as they lived.
 *
 * So the question is asked only for a sticker that is about to be drawn, and
 * three things make that cheap:
 *
 * - **Shared.** The picker, the transcript and the settings page ask the same
 *   cache, and two askers for one id share one request.
 * - **Bounded in flight.** At most `MAX_CONCURRENT` requests run at once, and
 *   the queue is last-in-first-out: when the reader scrolls fast, the cells
 *   they are looking at *now* asked last. A request whose every asker has gone
 *   away before it started is dropped rather than run.
 * - **Bounded in memory.** Least recently used entries are evicted past
 *   `MAX_ENTRIES` or `MAX_CHARS` of URL text, whichever comes first — a data
 *   URL is as big as the file it carries, so a count alone bounds nothing.
 *
 * A failure is never cached: the next asker tries again.
 */

export const MAX_CONCURRENT = 4
const MAX_ENTRIES = 240
const MAX_CHARS = 48 * 1024 * 1024

interface Job {
  id: string
  waiters: number
  started: boolean
  promise: Promise<string>
  resolve: (url: string) => void
  reject: (reason: unknown) => void
}

function abortError(): Error {
  const error = new Error('sticker url request abandoned')
  error.name = 'AbortError'
  return error
}

class StickerUrlCache {
  #urls = new Map<string, string>()
  #chars = 0
  #jobs = new Map<string, Job>()
  #queue: Job[] = []
  #active = 0
  #generation = 0

  /** The cached URL, marking it recently used; `undefined` when not cached. */
  peek(id: string): string | undefined {
    const url = this.#urls.get(id)
    if (url === undefined) return undefined
    this.#urls.delete(id)
    this.#urls.set(id, url)
    return url
  }

  load(id: string, signal?: AbortSignal): Promise<string> {
    const cached = this.peek(id)
    if (cached !== undefined) return Promise.resolve(cached)
    if (signal?.aborted) return Promise.reject(abortError())

    let job = this.#jobs.get(id)
    if (!job) {
      let resolve!: (url: string) => void
      let reject!: (reason: unknown) => void
      const promise = new Promise<string>((res, rej) => {
        resolve = res
        reject = rej
      })
      // Nobody may be left to observe an abandoned job's rejection.
      promise.catch(() => {})
      job = { id, waiters: 0, started: false, promise, resolve, reject }
      this.#jobs.set(id, job)
      this.#queue.push(job)
    }
    const current = job
    current.waiters++
    signal?.addEventListener(
      'abort',
      () => {
        current.waiters--
        if (current.started || current.waiters > 0) return
        this.#queue = this.#queue.filter((queued) => queued !== current)
        this.#jobs.delete(current.id)
        current.reject(abortError())
      },
      { once: true },
    )
    this.#pump()
    return current.promise
  }

  /** An answer known without asking — the dev playground's stickers, which have no backend. */
  seed(id: string, url: string) {
    this.#store(id, url)
  }

  forget(id: string) {
    const url = this.#urls.get(id)
    if (url === undefined) return
    this.#urls.delete(id)
    this.#chars -= url.length
  }

  reset() {
    this.#urls.clear()
    this.#chars = 0
    this.#jobs.clear()
    this.#queue = []
    this.#active = 0
    this.#generation++
  }

  #pump() {
    while (this.#active < MAX_CONCURRENT && this.#queue.length > 0) {
      // Last in, first out: the newest asker is the one on screen.
      const job = this.#queue.pop()!
      job.started = true
      this.#active++
      const generation = this.#generation
      const finish = () => {
        if (generation !== this.#generation) return
        this.#active--
        this.#jobs.delete(job.id)
        this.#pump()
      }
      api.getEmojiFileUrl(job.id).then(
        (url) => {
          if (generation === this.#generation) this.#store(job.id, url)
          finish()
          job.resolve(url)
        },
        (reason: unknown) => {
          finish()
          job.reject(reason)
        },
      )
    }
  }

  #store(id: string, url: string) {
    this.forget(id)
    this.#urls.set(id, url)
    this.#chars += url.length
    for (const [oldest, old] of this.#urls) {
      if (this.#urls.size <= MAX_ENTRIES && this.#chars <= MAX_CHARS) break
      // The entry just stored survives even if it alone is over the budget:
      // the asker is waiting for it.
      if (oldest === id) break
      this.#urls.delete(oldest)
      this.#chars -= old.length
    }
  }
}

const cache = new StickerUrlCache()

export const peekStickerUrl = (id: string) => cache.peek(id)
export const loadStickerUrl = (id: string, signal?: AbortSignal) => cache.load(id, signal)
/** Dev playground only: stickers with no backend behind them, answered from memory. */
export const seedStickerUrl = (id: string, url: string) => cache.seed(id, url)
/** After a sticker is deleted, so an id reused by nothing keeps nothing. */
export const forgetStickerUrl = (id: string) => cache.forget(id)
/** Tests only: each test starts from an empty cache and an idle queue. */
export const resetStickerUrls = () => cache.reset()

export type StickerUrlState =
  { status: 'idle' } | { status: 'loading' } | { status: 'loaded'; url: string } | { status: 'error' }

/**
 * The URL for `id`, asked for only while `id` is non-null — pass `null` until
 * the sticker is near enough to be drawn. `attempt` is a retry counter: bumping
 * it asks again after a failure. A cached URL is answered in the same render,
 * so a cell scrolled back into view does not flash a placeholder.
 */
export function useStickerUrl(id: string | null, attempt = 0): StickerUrlState {
  const key = id === null ? null : `${id}#${attempt}`
  const cached = id === null ? undefined : cache.peek(id)
  const [settled, setSettled] = useState<{ key: string; url: string | null } | null>(null)

  useEffect(() => {
    if (id === null || key === null || cached !== undefined) return
    const controller = new AbortController()
    cache.load(id, controller.signal).then(
      (url) => {
        if (!controller.signal.aborted) setSettled({ key, url })
      },
      () => {
        if (!controller.signal.aborted) setSettled({ key, url: null })
      },
    )
    return () => controller.abort()
  }, [id, key, cached])

  if (id === null) return { status: 'idle' }
  if (cached !== undefined) return { status: 'loaded', url: cached }
  if (settled?.key === key) return settled.url === null ? { status: 'error' } : { status: 'loaded', url: settled.url }
  return { status: 'loading' }
}
