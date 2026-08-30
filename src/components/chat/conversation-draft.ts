import type { ChatMode, ThinkingLevel } from '@/types'
import type { AttachedFile, PendingSticker } from './input-bar'

/** Settings chosen before a conversation exists. They seed the first real
 * InputBar and, where the database has a matching preference, are persisted
 * as soon as the conversation is created. */
export interface DraftTurnSettings {
  selectedAssistantId: string | null
  selectedModelId: string | null
  selectedProviderId: string | null
  thinkingLevel: ThinkingLevel
  fastMode: boolean
  mode: ChatMode
  acceptEdits: boolean
}

export interface ComposerDraft {
  text: string
  attachedFiles: AttachedFile[]
  pendingSticker: PendingSticker | null
}

/** Everything the welcome-page composer must carry across the boundary where
 * its first press creates the conversation. Keeping the actual File objects
 * here is intentional: remote attachments may not have a local path. */
export interface InitialTurnDraft {
  text: string
  attachedFiles: AttachedFile[]
  pendingSticker: PendingSticker | null
  /** Voice transcription uses the same backend hint as an in-conversation
   * recording; without carrying it across creation the first recording would
   * silently become an ordinary typed turn. */
  voice: boolean
  /** A voice turn bypasses whatever is waiting in the typed composer. The
   * welcome component is about to unmount, so that untouched draft must seed
   * the real conversation composer instead of disappearing with it. */
  remainingComposer: ComposerDraft | null
  settings: DraftTurnSettings
}
