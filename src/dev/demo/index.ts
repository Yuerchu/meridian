import type { UnlistenFn } from '@tauri-apps/api/event'
import { parseAppEventPayload, type AppEventChannel, type AppEventPayloadMap } from '@/lib/app-event'
import { assertInvokeResponse } from '@/lib/invoke-response-schema'
import type { Transport } from '@/lib/transport'
import { demoUnsupported, emptyAnswerFor, isVoidCommand } from './fallback'
import { DEMO_HANDLERS } from './handlers'
import { createDemoState, type DemoOptions, type DemoState } from './state'

/**
 * The fixture backend `pnpm dev` talks to in a plain browser.
 *
 * Reached only through the dynamic import in `lib/transport.ts`, which is dead
 * code in a release build — nothing under `dev/demo/` is ever emitted there.
 * Every answer goes through the same `assertInvokeResponse` the real transports
 * use, and every event through the same `parseAppEventPayload`, so a fixture
 * that drifts from the contract fails here exactly as a backend would.
 */
export type DemoArgs = Record<string, unknown> | undefined

export interface DemoBackend {
  readonly state: DemoState
  emit<C extends AppEventChannel>(channel: C, payload: AppEventPayloadMap[C]): void
  /** Deferred work — the ticks of a replayed stream, mostly. */
  later(ms: number, task: () => void): void
}

export type DemoHandler = (args: DemoArgs, backend: DemoBackend) => unknown

type Listener = (event: { payload: unknown }) => void

export function createDemoBackend(options: DemoOptions = {}): DemoBackend & {
  invoke(cmd: string, args: DemoArgs): Promise<unknown>
  subscribe(channel: string, handler: Listener): UnlistenFn
} {
  const listeners = new Map<string, Set<Listener>>()
  const backend = {
    state: createDemoState(options),
    emit<C extends AppEventChannel>(channel: C, payload: AppEventPayloadMap[C]) {
      // Validated before anybody hears it, the way a remote frame is.
      parseAppEventPayload(channel, payload)
      for (const listener of listeners.get(channel) ?? []) listener({ payload })
    },
    later(ms: number, task: () => void) {
      setTimeout(task, ms)
    },
    async invoke(cmd: string, args: DemoArgs): Promise<unknown> {
      const handler = DEMO_HANDLERS[cmd]
      let value: unknown
      if (handler) {
        // Cloned so no caller can reach into the fixture state and edit it
        // behind the handlers' back, which a real IPC boundary would forbid too.
        value = structuredClone(await handler(args, backend))
      } else {
        const empty = emptyAnswerFor(cmd)
        if (!empty) throw demoUnsupported(cmd)
        if (!isVoidCommand(cmd)) console.info(`[demo] ${cmd}: answered with an empty result`)
        value = empty.value
      }
      assertInvokeResponse(cmd, args, value)
      return value
    },
    subscribe(channel: string, handler: Listener): UnlistenFn {
      const set = listeners.get(channel) ?? new Set()
      set.add(handler)
      listeners.set(channel, set)
      return () => {
        set.delete(handler)
      }
    },
  }
  return backend
}

/** `?demo=quiet` starts with nothing waiting on an answer — for screenshots
 *  that should not have approval toasts over them. */
function optionsFromUrl(): DemoOptions {
  return { quiet: new URLSearchParams(window.location.search).get('demo') === 'quiet' }
}

export function createDemoTransport(): Transport {
  const backend = createDemoBackend(optionsFromUrl())
  console.info('[demo] no Tauri backend: answering from the fixtures in src/dev/demo')
  return {
    invoke: async <T>(cmd: string, args?: Record<string, unknown>) => (await backend.invoke(cmd, args)) as T,
    listen: <T>(channel: string, handler: (event: { payload: T }) => void) =>
      Promise.resolve(backend.subscribe(channel, handler as Listener)),
  }
}
