import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/api'
import type { DraftTurnSettings } from '@/components/chat/conversation-draft'
import { useConversationStore } from '@/stores/conversation-store'
import type {
  AssistantInfoResponse,
  ChatMode,
  ProviderInfoResponse,
  ProviderCapabilitiesInfoResponse,
  ThinkingLevel,
} from '@/types'

export interface TurnSettings {
  assistants: AssistantInfoResponse[]
  providers: ProviderInfoResponse[]
  selectedAssistant: AssistantInfoResponse | undefined
  selectedAssistantId: string | null
  selectedModelId: string | null
  selectedProviderId: string | null
  thinkingLevel: ThinkingLevel
  fastMode: boolean
  mode: ChatMode
  acceptEdits: boolean
  capabilities: ProviderCapabilitiesInfoResponse | null
  onSelectAssistant: (id: string) => void
  onSelectModel: (modelId: string, providerId: string) => void
  onSelectThinkingLevel: (level: ThinkingLevel) => void
  onToggleFast: (next: boolean) => void
  onSelectMode: (next: ChatMode) => void
  onToggleAcceptEdits: (next: boolean) => void
}

/**
 * Everything the toolbar decides about *how* the next turn is sent: which
 * assistant and model answer it, how hard they think, and what they are allowed
 * to touch.
 *
 * These live together because they are not independent — the model decides
 * which thinking tiers exist, and the conversation decides the model. Splitting
 * them apart would mean re-deriving that chain in three places.
 */
export function useTurnSettings(conversationId: string | null, initial?: DraftTurnSettings): TurnSettings {
  // A new-conversation composer has no row to persist to yet. Keep its explicit
  // choices alive locally, then hand the same seed to the first real ChatView so
  // a per-turn model override is not replaced by the assistant's default while
  // the assistant/provider lists are loading.
  //
  // Captured once. This hook's owner is keyed by conversation id; if an owner is
  // ever reused for another id, an old draft must not leak into it.
  const initialSelectionRef = useRef<{ conversationId: string | null; settings?: DraftTurnSettings }>({
    conversationId,
    settings: initial,
  })
  // TODO: every read below goes to `s.conversations`, which is the sidebar's
  // list — and a sub-agent's conversation is filtered out of it on purpose
  // (`db::ops::conversation::list_conversations`). Opened from a `run_agent`
  // card, this view therefore reads null for all of them and runs on defaults:
  // no assistant, work mode, accept-edits off. The snapshot already carries the
  // whole conversation, but `loadMessages` currently drops it.
  //
  // Fix is a `conversationDetails: Record<string, Conversation>` filled from the
  // snapshot plus a `conversationById` selector these fall back through — and
  // the same selector at `App.tsx`'s `activeConversation` (header title) and
  // `use-global-event-listener.ts`'s notification title, which have the same
  // hole. Not `conversations.push(...)`: that array *is* the sidebar.
  //
  // Deferred with the rest of the navigation work until the boardui change
  // lands, since it is the layer that will move.
  const conversationAssistantId = useConversationStore(
    (s) => s.conversations.find((c) => c.id === conversationId)?.assistant_id ?? null,
  )
  const conversationExists = useConversationStore(
    (s) => conversationId !== null && s.conversations.some((c) => c.id === conversationId),
  )
  // Kept as two primitive selectors: returning an object here would allocate a
  // fresh reference on every store update and re-render on each one.
  const conversationThinkingLevel = useConversationStore(
    (s) => s.conversations.find((c) => c.id === conversationId)?.thinking_level ?? null,
  )
  const conversationFastMode = useConversationStore(
    (s) => s.conversations.find((c) => c.id === conversationId)?.fast_mode ?? false,
  )
  const conversationMode = useConversationStore(
    (s) => (s.conversations.find((c) => c.id === conversationId)?.mode ?? 'work') as ChatMode,
  )
  const conversationAcceptEdits = useConversationStore(
    (s) => s.conversations.find((c) => c.id === conversationId)?.accept_edits ?? false,
  )
  const refreshConversations = useConversationStore((s) => s.refreshConversations)
  const storeSetError = useConversationStore((s) => s.setError)

  const [assistants, setAssistants] = useState<AssistantInfoResponse[]>([])
  const [providers, setProviders] = useState<ProviderInfoResponse[]>([])
  const [selectedAssistantId, setSelectedAssistantId] = useState<string | null>(initial?.selectedAssistantId ?? null)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(initial?.selectedModelId ?? null)
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(initial?.selectedProviderId ?? null)
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(initial?.thinkingLevel ?? 'default')
  const [fastMode, setFastMode] = useState(initial?.fastMode ?? false)
  const [mode, setMode] = useState<ChatMode>(initial?.mode ?? 'work')
  const [acceptEdits, setAcceptEdits] = useState(initial?.acceptEdits ?? false)
  const [capabilities, setCapabilities] = useState<ProviderCapabilitiesInfoResponse | null>(null)

  useEffect(() => {
    Promise.all([api.listAssistants(), api.listProviders()]).then(([a, p]) => {
      setAssistants(a)
      setProviders(p)
    })
  }, [])

  // Selection follows the conversation's bound assistant; falls back to the
  // global default only when the conversation has no (or a dangling) binding.
  useEffect(() => {
    if (assistants.length === 0) return
    const seeded =
      initialSelectionRef.current.conversationId === conversationId ? initialSelectionRef.current.settings : undefined
    const bound = conversationAssistantId ? assistants.find((x) => x.id === conversationAssistantId) : undefined
    const seededAssistant = seeded?.selectedAssistantId
      ? assistants.find((x) => x.id === seeded.selectedAssistantId)
      : undefined
    const effective = seededAssistant ?? bound ?? assistants.find((x) => x.is_default) ?? assistants[0]
    if (effective) {
      setSelectedAssistantId(effective.id)
      // Only preserve a model/provider override when its assistant survived
      // validation. A dangling assistant seed falls back as one unit instead of
      // applying its model to an unrelated default assistant.
      const seedMatches = seeded && (!seeded.selectedAssistantId || seeded.selectedAssistantId === effective.id)
      setSelectedModelId(
        seedMatches ? (seeded.selectedModelId ?? effective.model_id ?? null) : (effective.model_id ?? null),
      )
      setSelectedProviderId(
        seedMatches ? (seeded.selectedProviderId ?? effective.provider_id ?? null) : (effective.provider_id ?? null),
      )
      // The seed only bridges the initial catalog load. Keeping it afterwards
      // would make a later conversation update lose to stale welcome-page
      // choices instead of following the newly persisted assistant.
      if (seeded && (conversationId === null || conversationExists)) {
        initialSelectionRef.current.settings = undefined
      }
    }
  }, [conversationId, conversationExists, conversationAssistantId, assistants])

  const onSelectAssistant = useCallback(
    (id: string) => {
      initialSelectionRef.current.settings = undefined
      setSelectedAssistantId(id)
      const a = assistants.find((x) => x.id === id)
      if (a?.model_id) setSelectedModelId(a.model_id)
      if (a?.provider_id) setSelectedProviderId(a.provider_id)
      if (conversationId === null) return
      // Persist the explicit switch so the binding survives conversation changes
      api
        .setConversationAssistant({ id: conversationId, assistantId: id })
        .then(() => refreshConversations())
        .catch(() => {
          /* selection still applies locally for this session */
        })
    },
    [assistants, conversationId, refreshConversations],
  )

  const onSelectModel = useCallback((modelId: string, providerId: string) => {
    initialSelectionRef.current.settings = undefined
    setSelectedModelId(modelId)
    setSelectedProviderId(providerId)
  }, [])

  useEffect(() => {
    if (!selectedProviderId || !selectedModelId) {
      // Clearing matters: keeping the previous model's capabilities would leave
      // the toolbar offering tiers the current selection may not support.
      setCapabilities(null)
      return
    }
    api
      .getProviderCapabilities({ providerId: selectedProviderId, modelId: selectedModelId })
      .then(setCapabilities)
      // eslint-disable-next-line meridian-ui/no-default-on-load-failure -- null is "unknown": clamping is skipped, nothing is written
      .catch(() => setCapabilities(null))
  }, [selectedProviderId, selectedModelId])

  // Seed from the conversation's stored preferences on switch only. Keyed on
  // conversationId alone so a background refreshConversations() can't clobber
  // an edit the user just made.
  useEffect(() => {
    const seeded =
      initialSelectionRef.current.conversationId === conversationId ? initialSelectionRef.current.settings : undefined
    setThinkingLevel(seeded?.thinkingLevel ?? (conversationThinkingLevel as ThinkingLevel | null) ?? 'default')
    setFastMode(seeded?.fastMode ?? conversationFastMode)
    // `mode` is deliberately absent: unlike the two above it tracks the stored
    // value continuously (see below), because the backend changes it on its own
    // when a plan is approved.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed-on-switch; see comment
  }, [conversationId])

  // Fast mode has no meaningful representation on models that do not advertise
  // it. Thinking effort is deliberately not rewritten here: an unsupported
  // explicit tier must be rejected by the request boundary, never substituted.
  useEffect(() => {
    if (!capabilities) return
    if (capabilities.supports_fast !== true) setFastMode(false)
  }, [capabilities])

  const onSelectThinkingLevel = useCallback(
    (level: ThinkingLevel) => {
      setThinkingLevel(level)
      if (conversationId === null) return
      api
        .setConversationReasoningPrefs({
          id: conversationId,
          thinkingLevel: level === 'default' ? null : level,
          fastMode,
        })
        .then(() => refreshConversations())
        .catch(() => {
          /* selection still applies locally for this session */
        })
    },
    [conversationId, fastMode, refreshConversations],
  )

  const onToggleFast = useCallback(
    (next: boolean) => {
      setFastMode(next)
      if (conversationId === null) return
      api
        .setConversationReasoningPrefs({
          id: conversationId,
          thinkingLevel: thinkingLevel === 'default' ? null : thinkingLevel,
          fastMode: next,
        })
        .then(() => refreshConversations())
        .catch(() => {
          /* toggle still applies locally for this session */
        })
    },
    [conversationId, thinkingLevel, refreshConversations],
  )

  const onSelectMode = useCallback(
    (next: ChatMode) => {
      const previous = mode
      setMode(next)
      if (conversationId === null) return
      api
        .setConversationMode({ id: conversationId, mode: next === 'work' ? null : next })
        .then(() => refreshConversations())
        .catch((err) => {
          // Rolled back rather than kept locally, unlike the other two toggles.
          // The mode decides whether the model can edit files at all, so a
          // toolbar showing a mode that did not take effect is worse than an
          // error: the user would think they were in a read-only conversation.
          setMode(previous)
          storeSetError(conversationId, String(err))
        })
    },
    [conversationId, mode, refreshConversations, storeSetError],
  )

  const onToggleAcceptEdits = useCallback(
    (next: boolean) => {
      const previous = acceptEdits
      setAcceptEdits(next)
      if (conversationId === null) return
      api
        .setConversationAcceptEdits({ id: conversationId, acceptEdits: next })
        .then(() => refreshConversations())
        .catch((err) => {
          // Rolled back rather than kept locally, for the same reason as the mode:
          // a toolbar claiming edits are pre-approved when the backend never
          // recorded it would have the user expecting silence and getting prompts
          // — or worse, the reverse.
          setAcceptEdits(previous)
          storeSetError(conversationId, String(err))
        })
    },
    [conversationId, acceptEdits, refreshConversations, storeSetError],
  )

  // Tracks the stored value continuously: approving a plan switches the mode on
  // the backend, which emits `conversation-updated`, and the toolbar has to
  // follow rather than keep claiming the conversation is still planning.
  useEffect(() => {
    if (conversationId === null) return
    if (
      initialSelectionRef.current.conversationId === conversationId &&
      initialSelectionRef.current.settings !== undefined
    ) {
      return
    }
    setMode(conversationMode)
  }, [conversationId, conversationMode])

  // Same reason, plus one of its own: switching conversations must not carry a
  // standing approval over from the one before it.
  useEffect(() => {
    if (conversationId === null) return
    if (
      initialSelectionRef.current.conversationId === conversationId &&
      initialSelectionRef.current.settings !== undefined
    ) {
      return
    }
    setAcceptEdits(conversationAcceptEdits)
  }, [conversationId, conversationAcceptEdits])

  return {
    assistants,
    providers,
    selectedAssistant: assistants.find((a) => a.id === selectedAssistantId),
    selectedAssistantId,
    selectedModelId,
    selectedProviderId,
    thinkingLevel,
    fastMode,
    mode,
    acceptEdits,
    capabilities,
    onSelectAssistant,
    onSelectModel,
    onSelectThinkingLevel,
    onToggleFast,
    onSelectMode,
    onToggleAcceptEdits,
  }
}
