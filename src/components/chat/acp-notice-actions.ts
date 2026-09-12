import { createContext } from 'react'

/**
 * What pressing a notice's recommended action does. Provided by the chat view,
 * which is the one thing that can send a message or close the adapter; the
 * bubble itself is drawn inside a turn that knows neither.
 *
 * `retry` re-sends the turn's question as a new prompt — a new attempt, so a
 * second user row is the honest record of it. `restartAgent` closes the
 * adapter process; the next message reopens it and resumes the same session,
 * which is the runtime replacement the adapter's `new_session` asks for after
 * a lost transport or a dead worker. `login` has no button: this app declares
 * no terminal-auth capability, so signing in happens in a terminal.
 *
 * A file of its own rather than a second export beside the component, so the
 * component file stays hot-reloadable.
 */
export interface AcpNoticeActions {
  retry: (text: string) => void
  restartAgent: () => void
  /** A turn is running, so neither action may be taken right now. */
  busy: boolean
}

export const AcpNoticeActionsContext = createContext<AcpNoticeActions | null>(null)
