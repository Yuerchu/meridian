import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event'

/**
 * How the frontend reaches a backend, wherever that backend is.
 *
 * Everything above this file was written against Tauri's `invoke` and `listen`
 * and does not need to know there is now a second answer. `api.ts` imports
 * these two names instead of the ones from `@tauri-apps`, and the 150-odd
 * methods below it are untouched.
 *
 * The signatures deliberately match Tauri's, including `listen` handing the
 * handler an object with a `payload` rather than the payload itself. Matching a
 * shape nobody likes is worth more than improving it here: the alternative is
 * touching every call site, and every call site touched is a chance to change
 * behaviour while claiming to change transport.
 */
export interface Transport {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>
  listen<T>(channel: string, handler: (event: { payload: T }) => void): Promise<UnlistenFn>
}

/**
 * Commands that always run on the device the user is holding, even when
 * everything else is being answered by a desktop across the room.
 *
 * These are about *this* hardware: the keyboard inset, the storage grant, the
 * camera, and where this device keeps its own secrets. Sending them to the host
 * would answer a question nobody asked — the host's keyboard is not up, the
 * host's camera is not the one being pointed at a receipt.
 *
 * The server refuses them too (`local` in the command table), so this is not a
 * security boundary; it is the difference between "refused" and "answered by
 * the right machine".
 */
const LOCAL_COMMANDS = new Set([
  'get_platform',
  'get_window_insets',
  'get_manage_storage_status',
  'request_manage_storage',
  'pick_saf_directory',
  'list_saf_roots',
  'remove_saf_root',
  'take_photo',
  'pick_gallery_image',
  'resolve_file_name',
  // This device's own keychain. The remote token itself is in there, so
  // sending these away would be circular as well as wrong.
  'get_secret',
  'set_secret',
  'delete_secret',
])

/** Channels emitted by this device rather than by whatever it is connected to. */
const LOCAL_CHANNELS = new Set(['insets-changed'])

/** Where the remote token lives on the client. */
const TOKEN_SECRET = 'REMOTE_TOKEN'

export const tauriTransport: Transport = {
  invoke: tauriInvoke,
  listen: (channel, handler) => tauriListen(channel, handler),
}

/** Where a remote client is pointed, and whether it is pointed anywhere. */
export interface RemoteConfig {
  host: string
  port: number
}

const CONFIG_KEY = 'meridian.remote'

/**
 * Read the connection settings.
 *
 * `localStorage` rather than the preferences table, and this is not an
 * oversight: in remote mode the preferences table is on the *other* machine, so
 * anything needed in order to connect cannot live there.
 */
export function readRemoteConfig(): RemoteConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RemoteConfig>
    if (!parsed.host || !parsed.port) return null
    return { host: parsed.host, port: parsed.port }
  } catch {
    return null
  }
}

export function writeRemoteConfig(config: RemoteConfig | null): void {
  if (config) localStorage.setItem(CONFIG_KEY, JSON.stringify(config))
  else localStorage.removeItem(CONFIG_KEY)
}

/**
 * The wire revision this build speaks.
 *
 * Mirrors `API_REV` in `src-tauri/src/remote/http.rs` and is bumped for the
 * same reason: a change one side would misread, never an addition the other can
 * ignore. Kept here rather than in the settings panel because it is a fact
 * about this file's protocol.
 */
export const CLIENT_API_REV = 2

/**
 * What `/healthz` said, reduced to the decision the user is waiting on.
 *
 * A version mismatch is called out as one. Left as a bare failure it reads as
 * a wrong address or a firewall, and the user retypes an address that was
 * always right — the two remedies (upgrade one side) have nothing in common
 * with each other.
 */
export type ProbeResult =
  | { ok: true; version: string; apiRev: number }
  /** Nothing answered, or what answered was not this app. */
  | { ok: false; reason: 'unreachable' | 'malformed' }
  | { ok: false; reason: 'client-too-old' | 'server-too-old'; apiRev: number; minClientRev: number }

/**
 * Ask an address whether it is a Meridian this device can talk to.
 *
 * Unauthenticated, because the route is: a client that cannot tell "nothing is
 * there" from "the token is wrong" cannot help the user with either. So this
 * answers the first question only, and a bad token surfaces later as a refusal
 * with a message of its own.
 */
export async function probeRemote(host: string, port: number, signal?: AbortSignal): Promise<ProbeResult> {
  let body: unknown
  try {
    const response = await fetch(`http://${host}:${port}/healthz`, { signal })
    body = await response.json()
  } catch {
    return { ok: false, reason: 'unreachable' }
  }

  const health = body as { app?: unknown; version?: unknown; apiRev?: unknown; minClientRev?: unknown } | null
  if (
    !health ||
    health.app !== 'meridian' ||
    typeof health.apiRev !== 'number' ||
    typeof health.minClientRev !== 'number'
  ) {
    return { ok: false, reason: 'malformed' }
  }

  const { apiRev, minClientRev } = health
  // The band the two ends agree on. Below it this build predates something the
  // desktop now requires; above it the desktop predates something this build
  // assumes is there.
  if (CLIENT_API_REV < minClientRev) return { ok: false, reason: 'client-too-old', apiRev, minClientRev }
  if (apiRev < CLIENT_API_REV) return { ok: false, reason: 'server-too-old', apiRev, minClientRev }
  return { ok: true, version: typeof health.version === 'string' ? health.version : '', apiRev }
}

/** What the connection is doing, for the one indicator that shows it. */
export type ConnectionState = 'connecting' | 'connected' | 'offline'

type StateListener = (state: ConnectionState) => void

class RemoteTransport implements Transport {
  private readonly base: string
  private readonly wsUrl: string
  /** Resolved once, then reused. Every request waits on it. */
  private readonly token: Promise<string>
  private socket: WebSocket | null = null
  private handlers = new Map<string, Set<(event: { payload: unknown }) => void>>()
  private state: ConnectionState = 'connecting'
  private stateListeners = new Set<StateListener>()
  private attempt = 0
  private closed = false
  /** Handed out by the server on every connect; see the `/assets` route. */
  private assetTicket: string | null = null

  constructor(config: RemoteConfig) {
    this.base = `http://${config.host}:${config.port}`
    this.wsUrl = `ws://${config.host}:${config.port}/events`
    this.token = tauriTransport.invoke<string | null>('get_secret', { key: TOKEN_SECRET }).then((t) => t ?? '')
    this.connect()
  }

  async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    if (LOCAL_COMMANDS.has(cmd)) return tauriTransport.invoke<T>(cmd, args)

    const token = await this.token
    let response: Response
    try {
      response = await fetch(`${this.base}/rpc/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cmd, args: args ?? {} }),
      })
    } catch {
      // A dead connection is not a command that failed, but the caller only has
      // one error path and this is what it will show.
      throw new Error('Meridian is not reachable')
    }

    const body = (await response.json().catch(() => null)) as { ok?: unknown; err?: string } | null
    if (!body) throw new Error(`unreadable response (${response.status})`)
    // Rejected with a string, which is what Tauri's `invoke` does for an
    // `Err(String)` — every existing `catch (err) { String(err) }` keeps working.
    if (body.err !== undefined) throw body.err
    return body.ok as T
  }

  listen<T>(channel: string, handler: (event: { payload: T }) => void): Promise<UnlistenFn> {
    if (LOCAL_CHANNELS.has(channel)) return tauriTransport.listen(channel, handler)

    const set = this.handlers.get(channel) ?? new Set()
    set.add(handler as (event: { payload: unknown }) => void)
    this.handlers.set(channel, set)
    return Promise.resolve(() => {
      set.delete(handler as (event: { payload: unknown }) => void)
    })
  }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  getState(): ConnectionState {
    return this.state
  }

  ticket(): string | null {
    return this.assetTicket
  }

  assetUrl(uri: string): string | undefined {
    if (!this.assetTicket) return undefined
    return `${this.base}/assets?uri=${encodeURIComponent(uri)}&ticket=${encodeURIComponent(this.assetTicket)}`
  }

  uploadUrl(): string {
    return `${this.base}/upload`
  }

  authHeader(): Promise<string> {
    return this.token.then((t) => `Bearer ${t}`)
  }

  private setState(next: ConnectionState) {
    if (this.state === next) return
    this.state = next
    for (const listener of this.stateListeners) listener(next)
  }

  private async connect() {
    if (this.closed) return
    this.setState(this.attempt === 0 ? 'connecting' : this.state)

    const token = await this.token
    const socket = new WebSocket(this.wsUrl)
    this.socket = socket

    socket.onopen = () => {
      // The token goes in the first frame, not a header: a browser cannot set
      // one on a `WebSocket`, and a query string ends up in logs.
      socket.send(JSON.stringify({ token }))
    }

    socket.onmessage = (event) => {
      let frame: { channel?: string; payload?: unknown }
      try {
        frame = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (!frame.channel) return

      if (frame.channel === 'remote-ready') {
        const payload = frame.payload as { assetTicket?: string; apiRev?: number } | undefined
        this.assetTicket = payload?.assetTicket ?? null
        // The socket carries the revision too, and this is the only place it
        // gets re-read. `probeRemote` checks it once, at the moment somebody
        // types an address; a reconnect days later can land on a desktop that
        // has since been downgraded, and then the first command this build
        // added comes back as `unknown command` from a connection that
        // reported itself healthy.
        if (typeof payload?.apiRev === 'number' && payload.apiRev < CLIENT_API_REV) {
          console.warn(
            `remote: this desktop speaks api rev ${payload.apiRev}, this client expects ${CLIENT_API_REV}; ` +
              'newer features will fail until it is updated',
          )
        }
        const reconnected = this.attempt > 0
        this.attempt = 0
        this.setState('connected')
        // Anything that happened while the socket was down is simply gone --
        // events are not replayed, because a transcript with a hole in it is
        // worse than one that reloads. Whoever is listening refetches.
        if (reconnected) this.dispatch('remote-resync', {})
        return
      }

      this.dispatch(frame.channel, frame.payload)
    }

    socket.onclose = () => {
      this.socket = null
      this.assetTicket = null
      if (this.closed) return
      this.setState('offline')
      this.attempt += 1
      // 1s doubling to 30s, with jitter so several devices waking together do
      // not retry in lockstep.
      const backoff = Math.min(30_000, 1000 * 2 ** (this.attempt - 1))
      setTimeout(() => this.connect(), backoff * (0.5 + Math.random()))
    }

    socket.onerror = () => socket.close()
  }

  private dispatch(channel: string, payload: unknown) {
    const set = this.handlers.get(channel)
    if (!set) return
    for (const handler of set) handler({ payload })
  }

  close() {
    this.closed = true
    this.socket?.close()
  }
}

/**
 * The transport this session uses, decided once.
 *
 * Deliberately not switchable at runtime. Every store, every open conversation
 * and every in-flight turn is holding state that belongs to one backend, and
 * moving all of it is a much harder problem than reloading — which the settings
 * page does after writing the new configuration.
 */
const remoteConfig = typeof localStorage === 'undefined' ? null : readRemoteConfig()
const remote = remoteConfig ? new RemoteTransport(remoteConfig) : null

export const transport: Transport = remote ?? tauriTransport

/** Whether this session is talking to another machine. */
export const isRemote = remote !== null

/** `null` on the desktop, where there is no connection to have a state. */
export const remoteConnection = remote

/**
 * Forwards without adding an argument.
 *
 * `invoke(cmd)` and `invoke(cmd, undefined)` mean the same thing to Tauri, but
 * they are not the same call — and `api.test.ts` asserts the shape of what
 * `api.ts` passes down. Inserting a layer should not change that: what the api
 * layer sends is its contract, not this file's.
 */
export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return args === undefined ? transport.invoke<T>(cmd) : transport.invoke<T>(cmd, args)
}

export const listen: Transport['listen'] = (channel, handler) => transport.listen(channel, handler)
