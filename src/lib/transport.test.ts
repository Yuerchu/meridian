import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen } from '@tauri-apps/api/event'

/**
 * The transport, exercised as a remote client.
 *
 * Every test re-imports the module, because the decision it exists to make —
 * local or remote — is taken once at module load from `localStorage`. That is
 * deliberate in the source (see the note on `transport`), which means a test
 * cannot flip it and has to reload instead.
 *
 * `api.test.ts` mocks this transport boundary and owns command argument shape;
 * this file owns local/remote routing and response validation.
 */

vi.mock('@tauri-apps/api/core')
vi.mock('@tauri-apps/api/event')

const mockInvoke = vi.mocked(tauriInvoke)
const mockListen = vi.mocked(tauriListen)

/** Every socket the module under test has opened, newest last. */
let sockets: FakeSocket[] = []

class FakeSocket {
  static readonly OPEN = 1
  readonly sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(readonly url: string) {
    sockets.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.onclose?.()
  }

  /** What the server sends the moment it has accepted the token. */
  ready(assetTicket = 'ticket-1', apiRev = 3) {
    this.onmessage?.({ data: JSON.stringify({ channel: 'remote-ready', payload: { assetTicket, apiRev } }) })
  }
}

/**
 * Load a fresh copy of the module pointed at a host, and let its constructor
 * get as far as opening a socket.
 *
 * The token is resolved from the keychain with an `await`, so the `WebSocket`
 * does not exist until the microtask queue has been drained at least once.
 */
async function loadRemote() {
  localStorage.setItem('meridian.remote', JSON.stringify({ host: '10.0.0.7', port: 8787 }))
  const module = await import('./transport')
  // Two turns: one for the `get_secret` promise, one for the `await` inside
  // `connect` that follows it.
  await Promise.resolve()
  await Promise.resolve()
  return module
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  sockets = []
  mockInvoke.mockReset()
  mockListen.mockReset()
  // Whatever else a test does, the token comes from this device's keychain.
  mockInvoke.mockImplementation(async (cmd: string) => (cmd === 'get_secret' ? 'sekrit' : undefined))
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function respondWith(body: unknown, status = 200) {
  vi.mocked(globalThis.fetch).mockResolvedValueOnce({
    status,
    json: async () => body,
  } as Response)
}

describe('remote invoke', () => {
  it('posts the command and its arguments unchanged', async () => {
    const { invoke } = await loadRemote()
    respondWith({ ok: null })

    await invoke('delete_conversation', { id: 'abc' })

    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toBe('http://10.0.0.7:8787/rpc/invoke')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ cmd: 'delete_conversation', args: { id: 'abc' } })
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sekrit')
  })

  it('sends an empty argument object when there are none', async () => {
    const { invoke } = await loadRemote()
    respondWith({ ok: [] })

    await invoke('list_projects')

    const [, init] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(JSON.parse(String(init?.body))).toEqual({ cmd: 'list_projects', args: {} })
  })

  it('unwraps ok', async () => {
    const { invoke } = await loadRemote()
    respondWith({ ok: 'new-token' })

    await expect(invoke('regenerate_hooks_token')).resolves.toBe('new-token')
  })

  it('unwraps an ok that is null rather than treating it as absent', async () => {
    const { invoke } = await loadRemote()
    respondWith({ ok: null })

    await expect(invoke('rate_message', { id: '1', rating: null })).resolves.toBeNull()
  })

  // Every existing call site catches with `String(err)`, which Tauri's own
  // `Err(String)` satisfies. Rejecting with an `Error` here would print
  // "Error: ..." for one transport and not the other.
  it('rejects err as the bare string', async () => {
    const { invoke } = await loadRemote()
    respondWith({ err: 'model is not configured' })

    await expect(invoke('chat', {})).rejects.toBe('model is not configured')
  })

  it('rejects a body it cannot read', async () => {
    const { invoke } = await loadRemote()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      status: 502,
      json: async () => {
        throw new Error('not json')
      },
    } as unknown as Response)

    await expect(invoke('chat', {})).rejects.toThrow('unreadable response (502)')
  })

  it('rejects missing, mixed, and unknown response fields', async () => {
    const { invoke } = await loadRemote()
    for (const body of [{}, { ok: 1, err: 'no' }, { ok: 1, future: true }, { err: 7 }]) {
      respondWith(body)
      await expect(invoke('chat', {})).rejects.toThrow(/malformed response|err must be a string/)
    }
  })

  it('rejects a malformed command payload inside an otherwise valid ok envelope', async () => {
    const { invoke } = await loadRemote()
    respondWith({ ok: [{ id: 'project-1' }] })

    await expect(invoke('list_projects')).rejects.toThrow('must be present')
  })

  it('reports a dead connection as one', async () => {
    const { invoke } = await loadRemote()
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(invoke('chat', {})).rejects.toThrow('Meridian is not reachable')
  })
})

describe('commands that belong to this device', () => {
  it.each([
    ['get_secret', 'local answer'],
    ['set_secret', null],
    ['delete_secret', true],
    ['get_platform', 'windows'],
    ['get_window_insets', { top: 0, right: 0, bottom: 0, left: 0, imeBottom: 0 }],
    ['take_photo', 'file:///photo.jpg'],
  ])('%s never leaves the device', async (cmd, answer) => {
    const { invoke } = await loadRemote()
    mockInvoke.mockClear()
    mockInvoke.mockResolvedValueOnce(answer)

    await expect(invoke(cmd, { key: 'K' })).resolves.toEqual(answer)

    expect(mockInvoke).toHaveBeenCalledWith(cmd, { key: 'K' })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('sends everything else over the wire instead', async () => {
    const { invoke } = await loadRemote()
    mockInvoke.mockClear()
    respondWith({ ok: { key: 'shell', value: 'bash' } })

    await invoke('get_preference', { request: { key: 'shell' } })

    expect(mockInvoke).not.toHaveBeenCalled()
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps this device’s own channels local', async () => {
    const { listen } = await loadRemote()
    mockListen.mockResolvedValueOnce(() => {})

    await listen('insets-changed', () => {})

    expect(mockListen).toHaveBeenCalledWith('insets-changed', expect.any(Function))
  })
})

describe('the event socket', () => {
  it('dials the configured address', async () => {
    await loadRemote()
    expect(sockets).toHaveLength(1)
    expect(sockets[0].url).toBe('ws://10.0.0.7:8787/events')
  })

  // A browser cannot set a header on a WebSocket, and a query string ends up in
  // logs, so the first frame is the credential.
  it('sends the token as its first frame', async () => {
    await loadRemote()
    sockets[0].onopen?.()

    expect(sockets[0].sent).toEqual([JSON.stringify({ token: 'sekrit' })])
  })

  it('reports connected once the server has accepted it', async () => {
    const { remoteConnection } = await loadRemote()
    expect(remoteConnection?.getState()).toBe('connecting')

    sockets[0].onopen?.()
    sockets[0].ready()

    expect(remoteConnection?.getState()).toBe('connected')
  })

  // The same test the probe applies, applied again where a reconnect can land
  // on a downgraded desktop: below the band is a refusal, not a `connected`
  // that then fails one command at a time.
  it('refuses a server below the revision band instead of reporting connected', async () => {
    vi.useFakeTimers()
    const { remoteConnection, CLIENT_API_REV } = await loadRemote()

    sockets[0].onopen?.()
    sockets[0].onmessage?.({
      data: JSON.stringify({
        channel: 'remote-ready',
        payload: { assetTicket: 'ticket-1', apiRev: CLIENT_API_REV - 1 },
      }),
    })

    expect(remoteConnection?.getState()).toBe('offline')
    expect(remoteConnection?.assetUrl('file:///tmp/a.png')).toBeUndefined()

    // And it keeps dialling on the ordinary backoff, because the one thing
    // that fixes this — upgrading the desktop — looks exactly like a
    // reconnect from here.
    await vi.advanceTimersByTimeAsync(2000)
    expect(sockets).toHaveLength(2)
  })

  it('rejects malformed event frames', async () => {
    const { remoteConnection } = await loadRemote()
    sockets[0].onopen?.()

    sockets[0].onmessage?.({ data: 'not json' })
    expect(remoteConnection?.getState()).toBe('offline')
  })

  it('rejects a newer ready revision', async () => {
    const { remoteConnection, CLIENT_API_REV } = await loadRemote()
    sockets[0].onopen?.()
    sockets[0].onmessage?.({
      data: JSON.stringify({ channel: 'remote-ready', payload: { assetTicket: 'ticket', apiRev: CLIENT_API_REV + 1 } }),
    })
    expect(remoteConnection?.getState()).toBe('offline')
  })

  it('rejects an unknown event channel', async () => {
    const { remoteConnection } = await loadRemote()
    sockets[0].onopen?.()
    sockets[0].ready()
    sockets[0].onmessage?.({ data: JSON.stringify({ channel: 'future-event', payload: {} }) })
    expect(remoteConnection?.getState()).toBe('offline')
  })

  it('delivers a frame to whoever is listening on its channel', async () => {
    const { listen, remoteConnection } = await loadRemote()
    const seen: unknown[] = []
    await listen('chat-stream', (event) => seen.push(event.payload))
    const payload = { type: 'text', content: 'hi', message_id: 'm1', conversation_id: 'c1' }

    sockets[0].onopen?.()
    sockets[0].ready()
    sockets[0].onmessage?.({ data: JSON.stringify({ channel: 'chat-stream', payload }) })

    expect(seen).toEqual([payload])
    expect(remoteConnection?.assetUrl('file:///tmp/a.png')).toContain('ticket=ticket-1')
  })

  it.each(['plan-review-requested', 'plan-review-updated'] as const)(
    'delivers the exact %s contract over the remote socket',
    async (channel) => {
      const { listen, remoteConnection } = await loadRemote()
      const seen: unknown[] = []
      await listen(channel, (event) => seen.push(event.payload))
      const payload = {
        review_id: 'review-1',
        conversation_id: 'conversation-1',
        document_id: 'document-1',
        revision_id: 'revision-1',
        turn_id: 'turn-1',
        status: 'approved',
        delivery_state: 'queued',
        lock_version: 1,
      }

      sockets[0].onopen?.()
      sockets[0].ready()
      sockets[0].onmessage?.({ data: JSON.stringify({ channel, payload }) })

      expect(seen).toEqual([payload])
      expect(remoteConnection?.getState()).toBe('connected')
    },
  )

  it('rejects a malformed chat-stream payload before dispatch', async () => {
    const { listen, remoteConnection } = await loadRemote()
    const seen: unknown[] = []
    await listen('chat-stream', (event) => seen.push(event.payload))

    sockets[0].onopen?.()
    sockets[0].ready()
    sockets[0].onmessage?.({
      data: JSON.stringify({
        channel: 'chat-stream',
        payload: { type: 'text', content: 'hi', message_id: 'm1', conversation_id: 'c1', future: true },
      }),
    })

    expect(seen).toEqual([])
    expect(remoteConnection?.getState()).toBe('offline')
  })

  it('rejects a malformed non-stream payload at the same boundary', async () => {
    const { listen, remoteConnection } = await loadRemote()
    const seen: unknown[] = []
    await listen('queue-updated', (event) => seen.push(event.payload))

    sockets[0].onopen?.()
    sockets[0].ready()
    sockets[0].onmessage?.({
      data: JSON.stringify({
        channel: 'queue-updated',
        // `delivered` is required even when it is false.
        payload: { conversation_id: 'c1' },
      }),
    })

    expect(seen).toEqual([])
    expect(remoteConnection?.getState()).toBe('offline')
  })

  it('stops delivering after the handler has been removed', async () => {
    const { listen } = await loadRemote()
    const seen: unknown[] = []
    const unlisten = await listen('chat-stream', (event) => seen.push(event.payload))
    unlisten()

    sockets[0].onmessage?.({
      data: JSON.stringify({
        channel: 'chat-stream',
        payload: { type: 'text', content: 'hi', message_id: 'm1', conversation_id: 'c1' },
      }),
    })

    expect(seen).toEqual([])
  })
})

describe('reconnection', () => {
  it('dials again after the socket drops, and says it is offline meanwhile', async () => {
    vi.useFakeTimers()
    const { remoteConnection } = await loadRemote()
    sockets[0].onopen?.()
    sockets[0].ready()

    const states: string[] = []
    remoteConnection?.onStateChange((s) => states.push(s))
    sockets[0].close()

    expect(states).toEqual(['offline'])
    expect(sockets).toHaveLength(1)

    // 1s doubling with jitter, so the first retry lands somewhere in [500,
    // 1500] — advancing past the top of that window is what makes this a test
    // of "it retries" rather than of `Math.random`.
    await vi.advanceTimersByTimeAsync(2000)

    expect(sockets).toHaveLength(2)
    expect(sockets[1].url).toBe('ws://10.0.0.7:8787/events')
  })

  // Events are not replayed — a transcript with a hole in it is worse than one
  // that reloads — so coming back has to tell whoever is listening to refetch.
  it('announces a resync when it comes back, but not on the first connect', async () => {
    vi.useFakeTimers()
    const { listen } = await loadRemote()
    const resyncs: unknown[] = []
    await listen('remote-resync', () => resyncs.push(true))

    sockets[0].onopen?.()
    sockets[0].ready()
    expect(resyncs).toHaveLength(0)

    sockets[0].close()
    await vi.advanceTimersByTimeAsync(2000)
    sockets[1].onopen?.()
    sockets[1].ready('ticket-2')

    expect(resyncs).toHaveLength(1)
  })

  it('backs off rather than retrying in a tight loop', async () => {
    vi.useFakeTimers()
    await loadRemote()

    sockets[0].close()
    await vi.advanceTimersByTimeAsync(2000)
    expect(sockets).toHaveLength(2)

    // Second failure: the window is [1000, 3000], so 500ms cannot have been
    // long enough.
    sockets[1].close()
    await vi.advanceTimersByTimeAsync(500)
    expect(sockets).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(3000)
    expect(sockets).toHaveLength(3)
  })
})

describe('probeRemote', () => {
  // Written against `CLIENT_API_REV` rather than a literal: a hard-coded band
  // starts failing on the next bump, which reads as a regression in the check
  // rather than as a test that named a number instead of the relationship.
  it('accepts a server inside the revision band', async () => {
    const { probeRemote, CLIENT_API_REV } = await import('./transport')
    respondWith({ app: 'meridian', version: '0.2.0', apiRev: CLIENT_API_REV, minClientRev: CLIENT_API_REV })

    await expect(probeRemote('10.0.0.7', 8787)).resolves.toEqual({
      ok: true,
      version: '0.2.0',
      apiRev: CLIENT_API_REV,
    })
    expect(globalThis.fetch).toHaveBeenCalledWith('http://10.0.0.7:8787/healthz', { signal: undefined })
  })

  it('names a version mismatch as one rather than as a bad address', async () => {
    const { probeRemote, CLIENT_API_REV } = await import('./transport')
    const newerRevision = CLIENT_API_REV + 1
    respondWith({ app: 'meridian', version: '9.0.0', apiRev: newerRevision, minClientRev: newerRevision })

    await expect(probeRemote('10.0.0.7', 8787)).resolves.toEqual({
      ok: false,
      reason: 'client-too-old',
      apiRev: newerRevision,
      minClientRev: newerRevision,
    })
  })

  it('refuses a server older than this client', async () => {
    const { probeRemote, CLIENT_API_REV } = await import('./transport')
    respondWith({ app: 'meridian', version: '0.1.0', apiRev: CLIENT_API_REV - 1, minClientRev: 0 })

    await expect(probeRemote('10.0.0.7', 8787)).resolves.toMatchObject({ ok: false, reason: 'server-too-old' })
  })

  it('does not mistake some other server for Meridian', async () => {
    const { probeRemote } = await import('./transport')
    respondWith({ status: 'ok' })

    await expect(probeRemote('10.0.0.7', 8787)).resolves.toEqual({ ok: false, reason: 'malformed' })
  })

  it('reports nothing answering', async () => {
    const { probeRemote } = await import('./transport')
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(probeRemote('10.0.0.7', 8787)).resolves.toEqual({ ok: false, reason: 'unreachable' })
  })
})

describe('the stored configuration', () => {
  it('round-trips, and clears', async () => {
    const { readRemoteConfig, writeRemoteConfig } = await import('./transport')

    expect(readRemoteConfig()).toBeNull()
    writeRemoteConfig({ host: 'desk.local', port: 9000 })
    expect(readRemoteConfig()).toEqual({ host: 'desk.local', port: 9000 })
    writeRemoteConfig(null)
    expect(readRemoteConfig()).toBeNull()
  })

  it('rejects half-written, malformed, mistyped, and extended entries', async () => {
    const { readRemoteConfig } = await import('./transport')

    localStorage.setItem('meridian.remote', '{"host":"desk.local"}')
    expect(() => readRemoteConfig()).toThrow('must contain exactly')
    localStorage.setItem('meridian.remote', 'not json')
    expect(() => readRemoteConfig()).toThrow('invalid meridian.remote JSON')
    localStorage.setItem('meridian.remote', '{"host":"desk.local","port":"8787"}')
    expect(() => readRemoteConfig()).toThrow('port must be an integer')
    localStorage.setItem('meridian.remote', '{"host":"desk.local","port":8787,"future":true}')
    expect(() => readRemoteConfig()).toThrow('must contain exactly')
  })

  it('stays local when nothing is stored', async () => {
    const { isRemote, remoteConnection } = await import('./transport')

    expect(isRemote).toBe(false)
    expect(remoteConnection).toBeNull()
    expect(sockets).toHaveLength(0)
  })

  it('rejects a malformed local Tauri response at the same boundary', async () => {
    mockInvoke.mockResolvedValueOnce({ top: 0, right: 0, bottom: 0, left: 0, imeBottom: 0, future: true })
    const { invoke } = await import('./transport')

    await expect(invoke('get_window_insets')).rejects.toThrow('unknown field "future"')
  })
})
