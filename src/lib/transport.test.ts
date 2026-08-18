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
 * `api.test.ts` covers the other half: with no configuration stored, everything
 * below is a straight pass-through to `@tauri-apps/api/core`, and those 330
 * assertions are what says so.
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
  ready(assetTicket = 'ticket-1') {
    this.onmessage?.({ data: JSON.stringify({ channel: 'remote-ready', payload: { assetTicket } }) })
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
    respondWith({ ok: [{ id: '1' }] })

    await expect(invoke('list_conversations', { archived: false })).resolves.toEqual([{ id: '1' }])
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

  it('reports a dead connection as one', async () => {
    const { invoke } = await loadRemote()
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'))

    await expect(invoke('chat', {})).rejects.toThrow('Meridian is not reachable')
  })
})

describe('commands that belong to this device', () => {
  it.each(['get_secret', 'set_secret', 'delete_secret', 'get_platform', 'get_window_insets', 'take_photo'])(
    '%s never leaves the device',
    async (cmd) => {
      const { invoke } = await loadRemote()
      mockInvoke.mockClear()
      mockInvoke.mockResolvedValueOnce('local answer')

      await expect(invoke(cmd, { key: 'K' })).resolves.toBe('local answer')

      expect(mockInvoke).toHaveBeenCalledWith(cmd, { key: 'K' })
      expect(globalThis.fetch).not.toHaveBeenCalled()
    },
  )

  it('sends everything else over the wire instead', async () => {
    const { invoke } = await loadRemote()
    mockInvoke.mockClear()
    respondWith({ ok: 'x' })

    await invoke('get_preference', { key: 'shell' })

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

  it('delivers a frame to whoever is listening on its channel', async () => {
    const { listen, remoteConnection } = await loadRemote()
    const seen: unknown[] = []
    await listen('chat-stream', (event) => seen.push(event.payload))

    sockets[0].onopen?.()
    sockets[0].ready()
    sockets[0].onmessage?.({ data: JSON.stringify({ channel: 'chat-stream', payload: { delta: 'hi' } }) })

    expect(seen).toEqual([{ delta: 'hi' }])
    expect(remoteConnection?.assetUrl('file:///tmp/a.png')).toContain('ticket=ticket-1')
  })

  it('stops delivering after the handler has been removed', async () => {
    const { listen } = await loadRemote()
    const seen: unknown[] = []
    const unlisten = await listen('chat-stream', (event) => seen.push(event.payload))
    unlisten()

    sockets[0].onmessage?.({ data: JSON.stringify({ channel: 'chat-stream', payload: 1 }) })

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
  it('accepts a server inside the revision band', async () => {
    const { probeRemote } = await import('./transport')
    respondWith({ app: 'meridian', version: '0.2.0', apiRev: 1, minClientRev: 1 })

    await expect(probeRemote('10.0.0.7', 8787)).resolves.toEqual({ ok: true, version: '0.2.0', apiRev: 1 })
    expect(globalThis.fetch).toHaveBeenCalledWith('http://10.0.0.7:8787/healthz', { signal: undefined })
  })

  it('names a version mismatch as one rather than as a bad address', async () => {
    const { probeRemote } = await import('./transport')
    respondWith({ app: 'meridian', version: '9.0.0', apiRev: 4, minClientRev: 3 })

    await expect(probeRemote('10.0.0.7', 8787)).resolves.toEqual({
      ok: false,
      reason: 'client-too-old',
      apiRev: 4,
      minClientRev: 3,
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

  it('treats a half-written entry as none at all', async () => {
    const { readRemoteConfig } = await import('./transport')

    localStorage.setItem('meridian.remote', '{"host":"desk.local"}')
    expect(readRemoteConfig()).toBeNull()
    localStorage.setItem('meridian.remote', 'not json')
    expect(readRemoteConfig()).toBeNull()
  })

  it('stays local when nothing is stored', async () => {
    const { isRemote, remoteConnection } = await import('./transport')

    expect(isRemote).toBe(false)
    expect(remoteConnection).toBeNull()
    expect(sockets).toHaveLength(0)
  })
})
