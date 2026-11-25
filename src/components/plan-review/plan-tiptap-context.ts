import { createContext, useContext } from 'react'
import type { Editor } from '@tiptap/react'

export const PlanTiptapContext = createContext<{ editor: Editor | null }>({ editor: null })

/** Returns the active Tiptap editor instance from the nearest `PlanTiptap` root. */
export function usePlanTiptap() {
  return useContext(PlanTiptapContext)
}
