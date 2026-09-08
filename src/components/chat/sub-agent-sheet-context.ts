import { createContext, useContext } from 'react'
import type { SubAgentKind } from '@/types'

/** What a row of the delegation group asks to have opened. */
export interface SubAgentSheetRequest {
  conversationId: string
  turnId: string
  /** The `description` the parent gave the run — the sheet's title. */
  title: string
  kind: SubAgentKind
}

export interface SubAgentSheetContextValue {
  open: (request: SubAgentSheetRequest) => void
}

/**
 * Null where nothing can draw the sheet — the playground, a test — in which
 * case a row falls back to switching the whole window to the run's
 * conversation.
 */
export const SubAgentSheetContext = createContext<SubAgentSheetContextValue | null>(null)

export function useSubAgentSheet(): SubAgentSheetContextValue | null {
  return useContext(SubAgentSheetContext)
}
