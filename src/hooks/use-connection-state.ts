import { useSyncExternalStore } from 'react'

import { remoteConnection, type ConnectionState } from '@/lib/transport'

/**
 * Whether the machine answering this session is still answering.
 *
 * A local session reports `connected` and never changes, so nothing downstream
 * has to ask whether there is a connection before asking about its state —
 * `isRemote` is the question to ask when the distinction actually matters.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the state is
 * already live before React subscribes to it, and the effect version renders
 * one frame of the wrong answer whenever a component mounts into a connection
 * that has been offline for a while.
 */
function subscribe(onStoreChange: () => void): () => void {
  if (!remoteConnection) return () => {}
  return remoteConnection.onStateChange(onStoreChange)
}

function getSnapshot(): ConnectionState {
  return remoteConnection?.getState() ?? 'connected'
}

export function useConnectionState(): ConnectionState {
  // The third argument is the server snapshot, which this app never renders on
  // a server — passing the same reader keeps it from being a second source of
  // truth that could disagree.
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** The one state that has to change what the UI lets the user do. */
export function useIsOffline(): boolean {
  return useConnectionState() === 'offline'
}
