import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { DropZone } from 'react-aria-components'
import type { DropItem } from 'react-aria-components'
import { Button, Chip, Tooltip } from '@heroui/react'
import { Comments, Xmark } from '@gravity-ui/icons'
import { acceptsConversationDrop, CONVERSATION_DRAG_TYPE } from '@/components/layout/sidebar-dnd'
import { EmptyState as ProEmptyState } from '@heroui-pro/react/empty-state'
import { api } from '@/api'
import { ChatTranscript } from './chat-transcript'
import { CompactedRegion } from './compacted-region'
import { SubAgentSheetProvider } from './sub-agent-sheet'
import { TranscriptStatus } from './transcript-status'
import { useTurns } from '@/hooks/use-turns'
import { useTranscriptHotkeys } from '@/hooks/use-transcript-hotkeys'
import { InputBar, type AttachedFile, type PendingSticker } from './input-bar'
import { PromptQueue } from './prompt-queue'
import { TodoBar } from './todo-bar'
import { usePromptQueue } from '@/hooks/use-prompt-queue'
import { useEmojiMap } from './emoji-renderer'
import { useSenderNames } from '@/hooks/use-sender-names'
import { useTurnSettings } from '@/hooks/use-turn-settings'
import { useSendMessage } from '@/hooks/use-send-message'
import { useContextInfo } from '@/hooks/use-context-info'
import { useConfirm } from '@/hooks/use-confirm'
import { usePlatform } from '@/hooks/use-platform'
import { useConversationStore } from '@/stores/conversation-store'
import { usePlanReviewStore } from '@/stores/plan-review-store'
import { parseComposerIntent, referenceInputs } from '@/lib/composer-intent'
import { findComposerCommand } from '@/lib/composer-commands'
import { allowedEfforts } from '@/lib/thinking'
import { visibleSettingsTabs, type SettingsTab } from '@/components/settings/tabs'
import { isRemote } from '@/lib/transport'
import type { ChatMode, MessageRating, MessageViewModel, QueueDelivery, ThinkingLevel } from '@/types'
import { StarterPrompts } from './empty-state'
import type { InitialTurnDraft } from './conversation-draft'

// Stable identity for the empty case: `?? []` would hand useTurns a new array on
// every render of a conversation whose session has not been created yet.
const NO_MESSAGES: MessageViewModel[] = []

interface ShellSubmission {
  draft: string
  command: string
  turnId: string
}

function ChatViewInner({
  conversationId,
  initialDraft,
  onInitialDraftConsumed,
  onCreate,
  onOpenSettingsTab,
}: {
  conversationId: string
  initialDraft?: InitialTurnDraft | null
  onInitialDraftConsumed?: () => void
  onCreate?: () => void | Promise<void>
  onOpenSettingsTab?: (tab: SettingsTab) => void
}) {
  const session = useConversationStore((s) => s.sessions[conversationId])
  const planReviewSummaries = usePlanReviewStore((state) => state.summaries)
  const openPlanReview = usePlanReviewStore((state) => state.openReview)
  const storeEnsureSession = useConversationStore((s) => s.ensureSession)
  const storeLoadMessages = useConversationStore((s) => s.loadMessages)
  const storeLoadActiveTodos = useConversationStore((s) => s.loadActiveTodos)
  const storeSetError = useConversationStore((s) => s.setError)
  const storeSetCompacting = useConversationStore((s) => s.setCompacting)
  const storeBeginShellCommand = useConversationStore((s) => s.beginShellCommand)
  const storeAbortShellCommand = useConversationStore((s) => s.abortShellCommand)
  const storeFinishShellCommand = useConversationStore((s) => s.finishShellCommand)
  const isOneBot = useConversationStore((s) => {
    const conv = s.conversations.find((c) => c.id === conversationId)
    const project = conv?.project_id ? s.projects.find((p) => p.id === conv.project_id) : undefined
    return project?.source_type.startsWith('onebot') ?? false
  })
  const isHostedAgent = useConversationStore(
    (s) => s.conversations.find((c) => c.id === conversationId)?.agent_kind === 'claude_code',
  )

  const messages = session?.messages ?? NO_MESSAGES
  const streaming = session?.streaming ?? false
  const shellTurnId = session?.activeShellTurnId ?? null
  const compacting = session?.compacting ?? false
  const error = session?.error ?? null
  const redactionNotice = session?.redactionNotice ?? null
  const activeTodos = session?.activeTodos ?? null
  const pendingPlanReview = useMemo(
    () =>
      Object.values(planReviewSummaries).find(
        (review) =>
          review.conversation_id === conversationId &&
          (review.status === 'pending' ||
            review.delivery_state === 'queued' ||
            review.delivery_state === 'dispatched' ||
            review.delivery_state === 'held' ||
            review.delivery_state === 'in_doubt'),
      ) ?? null,
    [conversationId, planReviewSummaries],
  )
  const reviewBlocked = (session?.planReviewBarrier ?? false) || pendingPlanReview !== null

  const [input, setInput] = useState('')
  const [commandPending, setCommandPending] = useState(false)
  const commandPendingRef = useRef(false)
  const shellSubmittingRef = useRef(false)
  // A negative snapshot is not proof that the backend never accepted an
  // invoke whose response was lost. Keep that submission's idempotency key so
  // restoring or manually retyping the exact command cannot mint a new turn.
  const shellRetriesRef = useRef<ShellSubmission[]>([])
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [pendingSticker, setPendingSticker] = useState<PendingSticker | null>(null)
  /** Conversations dragged in from the sidebar, pending on the next message. */
  const [conversationRefs, setConversationRefs] = useState<{ id: string; title: string }[]>([])
  // What the *next* queued message will be, not a property of any row. Defaults
  // to the mode that waits: an interjection cuts into work that is already
  // going, which is not a thing to do by accident.
  const [queueDelivery, setQueueDelivery] = useState<QueueDelivery>('follow_up')
  const settings = useTurnSettings(conversationId, initialDraft?.settings)
  const platform = usePlatform()
  const emojiMap = useEmojiMap(settings.selectedAssistantId)
  // Only a OneBot conversation has more than one speaker; a desktop row has no
  // sender id to look up. Keyed on who is actually in the transcript so a
  // newcomer's first message fetches their nickname, and nothing else does.
  const speakerKey = useMemo(() => {
    if (!isOneBot) return null
    const ids = new Set<number>()
    for (const m of messages) {
      if (m.sender_id != null) ids.add(m.sender_id)
    }
    return [...ids].sort((a, b) => a - b).join(',')
  }, [isOneBot, messages])
  const senderNames = useSenderNames(speakerKey)
  const { t } = useTranslation()
  // What the barrier is waiting on. A decision already made is not a review
  // still owed: after Approve the turn is held until the agent has read the
  // decision, and telling the person to go and review it again is wrong twice.
  const reviewBlockedMessage =
    pendingPlanReview === null || pendingPlanReview.status === 'pending'
      ? t('chat.plan.reviewBlocked')
      : pendingPlanReview.delivery_state === 'held' || pendingPlanReview.delivery_state === 'in_doubt'
        ? t('chat.plan.deliveryAttention')
        : t('chat.plan.deliveryPending')
  const reviewBlockedAction =
    pendingPlanReview === null || pendingPlanReview.status === 'pending'
      ? t('chat.plan.review')
      : pendingPlanReview.delivery_state === 'held' || pendingPlanReview.delivery_state === 'in_doubt'
        ? t('chat.plan.resolveDelivery')
        : t('chat.plan.viewDelivery')
  const { confirm, confirmDialog } = useConfirm()

  const clearShellRetry = useCallback((turnId: string) => {
    shellRetriesRef.current = shellRetriesRef.current.filter((submission) => submission.turnId !== turnId)
  }, [])

  useEffect(() => {
    const durableTurnIds = new Set(
      messages
        .filter((message) => message.source === 'shell' && message.turn_id)
        .map((message) => message.turn_id as string),
    )
    if (durableTurnIds.size === 0) return

    const completed = shellRetriesRef.current.filter((submission) => durableTurnIds.has(submission.turnId))
    if (completed.length === 0) return
    shellRetriesRef.current = shellRetriesRef.current.filter((submission) => !durableTurnIds.has(submission.turnId))
    // A later reload may discover the row after an earlier negative check
    // restored the draft. Remove only that unchanged restored value; never
    // overwrite text the user entered while the request was in doubt.
    setInput((current) => (completed.some((submission) => submission.draft === current) ? '' : current))
  }, [messages])

  useEffect(() => {
    storeEnsureSession(conversationId)
    storeLoadMessages(conversationId)
    storeLoadActiveTodos(conversationId)
  }, [conversationId, storeEnsureSession, storeLoadMessages, storeLoadActiveTodos])

  const { sendMessage, steerMessage, handleRegenerate, handleEdit, handleVoiceSend } = useSendMessage(conversationId, {
    streaming,
    selectedAssistantId: settings.selectedAssistantId,
    selectedModelId: settings.selectedModelId,
    selectedProviderId: settings.selectedProviderId,
    thinkingLevel: settings.thinkingLevel,
    fastMode: settings.fastMode,
    mode: settings.mode,
  })

  // Read at click time rather than closed over, so the button always aims at
  // whatever is running now. Null falls back to "stop this conversation's
  // current turn", which is all a reloaded window knows.
  //
  // A hosted session stops through its own command, though **not because
  // `stop_chat` would miss it** — that used to be the reason given here and it
  // is not true. A hosted turn holds an ordinary lease, so `stop_chat` reaches
  // its cancellation token and `prompt_with` sends `session/cancel` off the
  // back of it. `acp_cancel` is the same act named for what it is, and it does
  // not need the turn id a reloaded window may not have.
  const handleStop = useCallback(() => {
    if (shellTurnId) {
      api.stopChat({ conversationId, turnId: shellTurnId })
      return
    }
    if (isHostedAgent) {
      api.acpCancel(conversationId)
      return
    }
    const turnId = useConversationStore.getState().sessions[conversationId]?.activeTurnId
    api.stopChat({ conversationId, turnId })
  }, [conversationId, isHostedAgent, shellTurnId])

  const handleDelete = useCallback(
    (id: string) => {
      api.deleteMessage({ conversationId, id }).then(() => {
        storeLoadMessages(conversationId)
      })
    },
    [conversationId, storeLoadMessages],
  )

  const handleRate = useCallback(
    (id: string, rating: MessageRating | null) => {
      api.rateMessage({ id, rating }).then(() => {
        storeLoadMessages(conversationId)
      })
    },
    [conversationId, storeLoadMessages],
  )

  const handleCompact = useCallback(
    async (instructions?: string) => {
      storeSetError(conversationId, null)
      try {
        await api.compact({ conversationId, customInstructions: instructions ?? null })
      } catch (err) {
        storeSetError(conversationId, String(err))
        storeSetCompacting(conversationId, false)
      }
    },
    [conversationId, storeSetError, storeSetCompacting],
  )

  const initialDraftSent = useRef<string | null>(null)

  // Memoised because useTurns keys its work on this array's identity; a fresh
  // filter() on every render would rebuild every turn on every stream chunk.
  const visibleMessages = useMemo(
    () => messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.is_compact_summary),
    [messages],
  )
  const allTurns = useTurns(visibleMessages, streaming, session?.turns)
  useTranscriptHotkeys(conversationId, allTurns)
  const compactSummary = messages.find((m) => m.is_compact_summary)
  // The boundary comes from the summary's anchor rather than a stored cursor:
  // once a conversation can branch, one sort_order threshold cannot describe
  // where the summary takes over on every path.
  const compactBoundary = useMemo(() => {
    const anchorId = compactSummary?.compact_anchor_id
    if (!anchorId) return null
    return messages.find((m) => m.id === anchorId)?.sort_order ?? null
  }, [compactSummary?.compact_anchor_id, messages])
  // Split by turn rather than by message: a boundary landing mid-turn used to
  // put the question in the compacted region and its answer in the active one.
  const compactedTurns = compactBoundary != null ? allTurns.filter((t) => t.firstSortOrder < compactBoundary) : []
  const activeTurns = compactBoundary != null ? allTurns.filter((t) => t.firstSortOrder >= compactBoundary) : allTurns
  const compactedCount =
    compactBoundary != null ? visibleMessages.filter((m) => m.sort_order < compactBoundary).length : 0

  const contextInfo = useContextInfo(conversationId, {
    assistant: settings.selectedAssistant,
    messageCount: messages.length,
    compactBoundary,
    compacting,
  })

  // Only a delegated run keeps an inbox open, and only while it is going. The
  // main conversation is unchanged: nothing can be submitted until the answer
  // is finished, because there is nowhere for it to go. Below `contextInfo`,
  // which is where the answer comes from.
  //
  // Named kinds rather than "has one at all". `steer_conversation` appends to
  // `sub_agent_inboxes`, which only a delegated run drains, while `agent_kind`
  // marks every conversation this app did not start on its own behalf — the
  // hook gates' reviews and now hosted Claude Code sessions. Read as a boolean
  // it lets the composer stay live during those and submit into an inbox that
  // does not exist, which comes back as "this run has already finished" on a
  // run that plainly has not.
  const steerable = contextInfo.agentKind === 'agent' || contextInfo.agentKind === 'explore'
  const steering = steerable && streaming

  // Everything with a runner behind it, which is a hosted session and an
  // ordinary conversation — but not a delegated run, which has `steerable` and
  // wants it: what is typed there goes straight into the run rather than being
  // stacked up for after it.
  const queueable = !steerable
  const queue = usePromptQueue(conversationId, queueable)
  const queueing = queueable && streaming

  const executeSlashCommand = useCallback(
    async (name: string, args: string, submittedDraft: string) => {
      if (commandPendingRef.current) {
        storeSetError(conversationId, t('chat.command.busy'))
        return
      }
      const command = findComposerCommand(name, {
        hasConversation: true,
        isHosted: isHostedAgent,
        // Hosted capabilities are dynamic and validated below. Keeping the
        // registry entry visible here lets a manually typed `/fast` receive the
        // adapter's real answer instead of being mistaken for an unknown name.
        supportsFast: isHostedAgent || settings.capabilities?.supports_fast === true,
      })
      if (!command) {
        storeSetError(conversationId, t('chat.command.unknown', { name }))
        return
      }
      const shellActive = useConversationStore.getState().sessions[conversationId]?.activeShellTurnId
      if ((streaming || shellActive) && command.busyPolicy === 'idle-only') {
        storeSetError(conversationId, t('chat.command.busy'))
        return
      }

      commandPendingRef.current = true
      setCommandPending(true)
      storeSetError(conversationId, null)
      const clearSubmittedDraft = () => setInput((current) => (current === submittedDraft ? '' : current))
      try {
        if (command.id === 'help') {
          setInput('/')
          return
        }
        if (command.id === 'new') {
          await onCreate?.()
          clearSubmittedDraft()
          return
        }
        if (command.id === 'settings') {
          const tab = args
            ? visibleSettingsTabs(platform).find((candidate) => candidate.id.toLowerCase() === args.toLowerCase())?.id
            : 'provider'
          if (!tab) {
            storeSetError(conversationId, t('chat.command.invalidArgument', { name: command.name, value: args }))
            return
          }
          onOpenSettingsTab?.(tab)
          clearSubmittedDraft()
          return
        }
        if (command.id === 'compact') {
          await handleCompact(args || undefined)
          clearSubmittedDraft()
          return
        }

        // A missing argument turns the same typeahead from command names to the
        // values that command accepts. It is a picker, not an implicit default.
        if (!args) {
          setInput(`/${command.name} `)
          return
        }

        if (isHostedAgent) {
          const options = await api.acpSessionConfig({ conversationId })
          const option = options.find((candidate) => {
            if (command.id === 'thinking') return candidate.id === 'effort' || candidate.category === 'thought_level'
            return candidate.id === command.id || candidate.category === command.id
          })
          const values = option && 'options' in option && Array.isArray(option.options) ? option.options : []
          const selected = values.find((value) => value.value.toLowerCase() === args.toLowerCase())
          if (!option || !selected) {
            storeSetError(conversationId, t('chat.command.invalidArgument', { name: command.name, value: args }))
            return
          }
          await api.acpSetSessionConfig({ conversationId, configId: option.id, value: selected.value })
          clearSubmittedDraft()
          return
        }

        if (command.id === 'model') {
          const providerId = settings.selectedProviderId
          if (!providerId) {
            storeSetError(conversationId, t('chat.command.invalidArgument', { name: command.name, value: args }))
            return
          }
          const models = await api.fetchProviderModels({ providerId, forceRefresh: null })
          const model = models.find(
            (candidate) =>
              candidate.id.toLowerCase() === args.toLowerCase() || candidate.name.toLowerCase() === args.toLowerCase(),
          )
          if (!model) {
            storeSetError(conversationId, t('chat.command.invalidArgument', { name: command.name, value: args }))
            return
          }
          settings.onSelectModel(model.id, providerId)
        } else if (command.id === 'thinking') {
          const values: ThinkingLevel[] = [
            'default',
            ...(settings.capabilities?.supports_thinking_off === false ? [] : (['off'] as ThinkingLevel[])),
            ...allowedEfforts(settings.capabilities),
          ]
          const value = values.find((candidate) => candidate === args.toLowerCase())
          if (!value) {
            storeSetError(conversationId, t('chat.command.invalidArgument', { name: command.name, value: args }))
            return
          }
          settings.onSelectThinkingLevel(value)
        } else if (command.id === 'mode') {
          const value = args.toLowerCase()
          if (value !== 'work' && value !== 'plan') {
            storeSetError(conversationId, t('chat.command.invalidArgument', { name: command.name, value: args }))
            return
          }
          settings.onSelectMode(value as ChatMode)
        } else if (command.id === 'fast') {
          const value = args.toLowerCase()
          if (value !== 'on' && value !== 'off') {
            storeSetError(conversationId, t('chat.command.invalidArgument', { name: command.name, value: args }))
            return
          }
          settings.onToggleFast(value === 'on')
        }
        clearSubmittedDraft()
      } finally {
        commandPendingRef.current = false
        setCommandPending(false)
      }
    },
    [
      conversationId,
      handleCompact,
      isHostedAgent,
      onCreate,
      onOpenSettingsTab,
      platform,
      settings,
      storeSetError,
      streaming,
      t,
    ],
  )

  const executeShellCommand = useCallback(
    async (command: string, originalDraft: string) => {
      if (!command) {
        storeSetError(conversationId, t('chat.shell.empty'))
        return
      }
      const activeShellTurn = useConversationStore.getState().sessions[conversationId]?.activeShellTurnId
      if (streaming || activeShellTurn || commandPendingRef.current || shellSubmittingRef.current) {
        storeSetError(conversationId, t('chat.shell.busy'))
        return
      }

      shellSubmittingRef.current = true
      let turnId: string | null = null
      try {
        if (!isRemote && (platform ?? (await api.getPlatform())) === 'android') {
          storeSetError(conversationId, t('chat.shell.androidUnavailable'))
          return
        }

        const durableTurnIds = new Set(
          (useConversationStore.getState().sessions[conversationId]?.messages ?? [])
            .filter((message) => message.source === 'shell' && message.turn_id)
            .map((message) => message.turn_id as string),
        )
        shellRetriesRef.current = shellRetriesRef.current.filter((submission) => !durableTurnIds.has(submission.turnId))
        let submission = shellRetriesRef.current.find(
          (candidate) => candidate.draft === originalDraft && candidate.command === command,
        )
        if (!submission) {
          submission = { draft: originalDraft, command, turnId: crypto.randomUUID() }
          shellRetriesRef.current.push(submission)
        }
        turnId = submission.turnId
        storeSetError(conversationId, null)
        storeBeginShellCommand(conversationId, turnId)
        setInput((current) => (current === originalDraft ? '' : current))
        let result = await api.runUserCommand({
          conversationId,
          command,
          turnId,
          retryWithoutSandbox: null,
        })
        clearShellRetry(turnId)
        storeFinishShellCommand(result)
        if (result.can_retry_without_sandbox) {
          const approved = await confirm({
            status: 'warning',
            title: t('chat.shell.retryTitle'),
            body: (
              <div data-slot="shell-retry-body" className="space-y-3">
                <p data-slot="shell-retry-text">{t('chat.shell.retryBody')}</p>
                <dl data-slot="shell-retry-details" className="space-y-2 rounded-xl bg-surface-secondary p-3 text-xs">
                  <div data-slot="shell-retry-detail">
                    <dt data-slot="shell-retry-detail-label" className="font-medium text-muted">
                      {t('chat.shell.commandLabel')}
                    </dt>
                    <dd data-slot="shell-retry-detail-value" className="mt-0.5 break-all font-mono text-foreground">
                      {command}
                    </dd>
                  </div>
                  <div data-slot="shell-retry-detail">
                    <dt data-slot="shell-retry-detail-label" className="font-medium text-muted">
                      {t('chat.shell.cwdLabel')}
                    </dt>
                    <dd data-slot="shell-retry-detail-value" className="mt-0.5 break-all font-mono text-foreground">
                      {result.cwd}
                    </dd>
                  </div>
                </dl>
              </div>
            ),
            confirmLabel: t('chat.shell.retryConfirm'),
          })
          if (approved) {
            storeBeginShellCommand(conversationId, turnId)
            result = await api.runUserCommand({
              conversationId,
              command,
              turnId,
              retryWithoutSandbox: true,
            })
            storeFinishShellCommand(result)
          }
        }
        if (result.error && result.status !== 'completed') storeSetError(conversationId, result.error)
      } catch (err) {
        if (!turnId) {
          setInput((current) => current || originalDraft)
          storeSetError(conversationId, String(err))
          return
        }

        // An invoke rejection is ambiguous: the backend may have run the side
        // effect and only lost its reply. Reload under the store's generation
        // guard. The draft becomes runnable again only when a successfully
        // applied snapshot proves that this UUID never acquired a durable
        // shell row. A failed/superseded reload stays in-doubt and keeps the
        // original command out of the composer.
        let confirmedAbsent = false
        try {
          const applied = await storeLoadMessages(conversationId)
          const messages = useConversationStore.getState().sessions[conversationId]?.messages ?? []
          const durable = messages.some((message) => message.source === 'shell' && message.turn_id === turnId)
          if (applied && durable) clearShellRetry(turnId)
          confirmedAbsent = applied && !durable
        } catch {
          // Absence was not established. Retrying under a new UUID could run an
          // already-started command twice, so ambiguity deliberately wins.
        }

        if (confirmedAbsent) {
          storeAbortShellCommand(conversationId, turnId, String(err))
          setInput((current) => current || originalDraft)
        } else {
          storeSetError(conversationId, String(err))
        }
      } finally {
        shellSubmittingRef.current = false
        if (turnId) {
          // The event path also reloads. This is best-effort repair for a lost
          // event/response and must not turn an already-handled command error
          // into an unhandled rejection of its own.
          try {
            await storeLoadMessages(conversationId)
          } catch {
            // The original error (if any) is already visible. A later
            // conversation load rehydrates both the row and the live lease.
          }
        }
      }
    },
    [
      confirm,
      clearShellRetry,
      conversationId,
      platform,
      storeAbortShellCommand,
      storeBeginShellCommand,
      storeFinishShellCommand,
      storeLoadMessages,
      storeSetError,
      streaming,
      t,
    ],
  )

  // The welcome composer becomes this composer after it creates the first
  // conversation. Parse that draft at the same boundary as every later submit
  // so `!` and `/` do not silently turn into ordinary model prompts merely
  // because they were typed on the empty screen.
  useEffect(() => {
    if (!initialDraft || initialDraftSent.current === conversationId) return
    if (reviewBlocked) return
    initialDraftSent.current = conversationId
    if (initialDraft.remainingComposer) {
      setInput(initialDraft.remainingComposer.text)
      setAttachedFiles(initialDraft.remainingComposer.attachedFiles)
      setPendingSticker(initialDraft.remainingComposer.pendingSticker)
    }
    onInitialDraftConsumed?.()

    const intent = parseComposerIntent(initialDraft.text)
    const hasPayload = initialDraft.voice || initialDraft.attachedFiles.length > 0 || !!initialDraft.pendingSticker
    if (!hasPayload && intent.kind === 'slash') {
      setInput(initialDraft.text)
      void executeSlashCommand(intent.name, intent.args, initialDraft.text).catch((error) =>
        storeSetError(conversationId, String(error)),
      )
      return
    }
    if (!hasPayload && intent.kind === 'shell') {
      setInput(initialDraft.text)
      void executeShellCommand(intent.command, initialDraft.text)
      return
    }

    const text = intent.kind === 'prompt' ? intent.text : initialDraft.text
    const sticker = initialDraft.pendingSticker
      ? {
          type: 'sticker' as const,
          sticker_id: initialDraft.pendingSticker.emoji.id,
          name: initialDraft.pendingSticker.emoji.name,
        }
      : undefined
    const firstReferences = intent.kind === 'prompt' ? referenceInputs(intent.references) : []
    const files = initialDraft.attachedFiles.length > 0 ? initialDraft.attachedFiles : undefined
    void sendMessage(text, true, files, undefined, initialDraft.voice || undefined, sticker, firstReferences)
  }, [
    conversationId,
    executeShellCommand,
    executeSlashCommand,
    initialDraft,
    onInitialDraftConsumed,
    sendMessage,
    storeSetError,
    reviewBlocked,
  ])

  /**
   * A conversation row dropped anywhere on the chat column becomes a pending
   * reference chip. The sidebar's rows are the only drag source for this type,
   * and the drop is a 'copy' — nothing moves; the thread is being cited.
   */
  const handleConversationDrop = useCallback(
    async (items: DropItem[]) => {
      for (const item of items) {
        if (item.kind !== 'text' || !item.types.has(CONVERSATION_DRAG_TYPE)) continue
        const id = await item.getText(CONVERSATION_DRAG_TYPE)
        if (!id) continue
        if (id === conversationId) {
          storeSetError(conversationId, t('chat.convRef.self'))
          continue
        }
        const title =
          useConversationStore.getState().conversations.find((c) => c.id === id)?.title ?? t('sidebar.newChat')
        setConversationRefs((prev) => (prev.some((ref) => ref.id === id) ? prev : [...prev, { id, title }]))
      }
    },
    [conversationId, storeSetError, t],
  )

  const handleSubmit = useCallback(() => {
    if (reviewBlocked) {
      storeSetError(conversationId, reviewBlockedMessage)
      if (pendingPlanReview) openPlanReview(pendingPlanReview.review_id)
      return
    }
    if (commandPendingRef.current) {
      storeSetError(conversationId, t('chat.command.busy'))
      return
    }
    if (shellSubmittingRef.current || useConversationStore.getState().sessions[conversationId]?.activeShellTurnId) {
      storeSetError(conversationId, t('chat.shell.busy'))
      return
    }
    const intent = parseComposerIntent(input)
    const text = intent.kind === 'prompt' ? intent.text.trim() : input.trim()
    const references = intent.kind === 'prompt' ? referenceInputs(intent.references) : []
    const refIds = conversationRefs.map((ref) => ref.id)
    // Both kinds freeze at a turn boundary, so both are refused where there is
    // no new boundary to attach them to (interject, steer).
    const hasWorkspaceReferences = references.length > 0 || refIds.length > 0
    if (!text && !pendingSticker) return

    // Commands are local control input. Resolve them before queue/steer so a
    // typo cannot become a delayed model prompt and an idle-only command never
    // claims to have been queued. A pending conversation reference keeps them
    // out too — a slash command starts no turn the reference could ride.
    if (intent.kind === 'slash' && !pendingSticker && attachedFiles.length === 0 && refIds.length === 0) {
      void executeSlashCommand(intent.name, intent.args, input).catch((err) =>
        storeSetError(conversationId, String(err)),
      )
      return
    }
    if (intent.kind === 'shell' && !pendingSticker && attachedFiles.length === 0 && refIds.length === 0) {
      void executeShellCommand(intent.command, input)
      return
    }

    // Ahead of everything else, including the slash commands: while the agent
    // is working there is no turn for any of them to reshape. The field is
    // cleared only once the row exists, so a refusal is not the user paying
    // for it by retyping.
    if (queueing) {
      if (!text) return
      if (hasWorkspaceReferences && queueDelivery === 'interject') {
        storeSetError(conversationId, t('chat.referenceFollowUpOnly'))
        return
      }
      void queue
        .enqueue(text, queueDelivery, references, refIds)
        .then(() => {
          setInput('')
          setConversationRefs([])
        })
        .catch((error) => storeSetError(conversationId, String(error)))
      return
    }

    // Before the slash commands, which all ask for a turn to be started or
    // reshaped and so have nowhere to land mid-run. The field is cleared only
    // once the run has taken the text: a refusal means it was written down
    // nowhere, and retyping it would be the user paying for that.
    if (steering) {
      if (!text) return
      if (hasWorkspaceReferences) {
        storeSetError(conversationId, t('chat.referenceFollowUpOnly'))
        return
      }
      void steerMessage(text).then((sent) => {
        if (sent) setInput('')
      })
      return
    }

    const files = [...attachedFiles]
    setInput('')
    setAttachedFiles([])
    const sticker = pendingSticker
      ? { type: 'sticker' as const, sticker_id: pendingSticker.emoji.id, name: pendingSticker.emoji.name }
      : undefined
    setPendingSticker(null)
    setConversationRefs([])
    sendMessage(text, true, files.length > 0 ? files : undefined, undefined, undefined, sticker, references, refIds)
  }, [
    input,
    sendMessage,
    attachedFiles,
    pendingSticker,
    conversationRefs,
    executeSlashCommand,
    executeShellCommand,
    storeSetError,
    conversationId,
    steering,
    steerMessage,
    queueing,
    queue,
    queueDelivery,
    t,
    reviewBlocked,
    reviewBlockedMessage,
    pendingPlanReview,
    openPlanReview,
  ])

  return (
    // The sheet a delegation row opens lives at this level so it can outlast
    // the row — the group re-renders on every step of a live run.
    <SubAgentSheetProvider>
      {/* A DropZone rather than a div, so a conversation dragged off the sidebar
        can land anywhere on the chat column. It registers with the same drag
        manager React Aria's tree hooks use, keyboard drags included; drags that
        are not conversations are refused and never highlight it. */}
      <DropZone
        aria-label={t('chat.convRef.dropLabel')}
        getDropOperation={(types) => (acceptsConversationDrop(types) ? 'copy' : 'cancel')}
        onDrop={(e) => void handleConversationDrop(e.items)}
        className="flex flex-col h-full data-[drop-target]:ring-2 data-[drop-target]:ring-accent data-[drop-target]:ring-inset"
      >
        <ChatTranscript
          turns={activeTurns}
          conversationId={conversationId}
          streaming={streaming}
          onDelete={handleDelete}
          // Regenerate and edit are withheld on a hosted session. Both re-ask
          // from a point in the history, and a hosted session's history lives in
          // the adapter's process — `useSendMessage` refuses them for exactly
          // that reason, so leaving the buttons up offers an action whose only
          // outcome is an error message. The refusal stays as the backstop; this
          // is the affordance agreeing with it. Delete is still offered: it does
          // what it says, removing rows from *this* app's copy.
          onRegenerate={isHostedAgent ? undefined : handleRegenerate}
          onEdit={isHostedAgent ? undefined : handleEdit}
          onRate={handleRate}
          isOneBot={isOneBot}
          isHosted={isHostedAgent}
          emojiMap={emojiMap}
          senderNames={senderNames}
          assistantAvatar={settings.selectedAssistant?.avatar}
          leading={
            <CompactedRegion
              turns={compactedTurns}
              conversationId={conversationId}
              compactedCount={compactedCount}
              compactSummary={compactSummary}
              onDelete={handleDelete}
              isOneBot={isOneBot}
              emojiMap={emojiMap}
              senderNames={senderNames}
              assistantAvatar={settings.selectedAssistant?.avatar}
            />
          }
          trailing={<TranscriptStatus compacting={compacting} error={error} redactionNotice={redactionNotice} />}
          emptyState={
            messages.length === 0 && !error ? (
              <ProEmptyState size="md" className="flex-1 justify-center px-4 py-10">
                <ProEmptyState.Header>
                  <ProEmptyState.Title>{t('chat.empty.subtitle')}</ProEmptyState.Title>
                  <ProEmptyState.Description>{t('chat.startHint')}</ProEmptyState.Description>
                </ProEmptyState.Header>
                <ProEmptyState.Content className="w-full max-w-2xl">
                  <StarterPrompts
                    disabled={streaming || !!shellTurnId || commandPending || reviewBlocked}
                    onSelect={setInput}
                  />
                </ProEmptyState.Content>
              </ProEmptyState>
            ) : null
          }
          scrollToBottomLabel={t('chat.scrollToBottom')}
        />

        {/* Folded into the queue card when something is stacked: HeroUI's Queue
          is current-plus-rows, and a TodoBar sitting above it made every
          queued message look nested under the checklist — interject and
          follow-up alike. Alone, the bar keeps its own card. */}
        {queue.items.length === 0 && <TodoBar conversationId={conversationId} />}

        {/* Pending conversation references, above the composer the way queued
          rows are: they belong to the next message, not to the one being
          typed. Pressing a chip removes it. */}
        {conversationRefs.length > 0 && (
          <div
            data-slot="conversation-refs-pending"
            role="group"
            aria-label={t('chat.convRef.pending')}
            className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border px-4 py-2"
          >
            {conversationRefs.map((ref) => (
              <Chip key={ref.id} size="sm" variant="soft" className="pr-0.5">
                <Comments className="size-3.5" aria-hidden />
                <span data-slot="conversation-ref-title" className="max-w-48 truncate">
                  {ref.title}
                </span>
                <Tooltip delay={0}>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="ghost"
                    aria-label={t('chat.convRef.remove', { name: ref.title })}
                    onPress={() => setConversationRefs((prev) => prev.filter((r) => r.id !== ref.id))}
                    className="touch-hitbox size-5 min-w-0 rounded-full"
                  >
                    <Xmark className="size-3" />
                  </Button>
                  <Tooltip.Content>{t('chat.convRef.remove', { name: ref.title })}</Tooltip.Content>
                </Tooltip>
              </Chip>
            ))}
          </div>
        )}

        {reviewBlocked && (
          <div
            data-slot="review-blocked-notice"
            className="flex shrink-0 items-center gap-3 border-t border-border bg-accent-soft px-4 py-2 text-xs text-accent"
          >
            <p data-slot="review-blocked-message" className="min-w-0 flex-1">
              {reviewBlockedMessage}
            </p>
            {pendingPlanReview && (
              <Button size="sm" variant="ghost" onPress={() => openPlanReview(pendingPlanReview.review_id)}>
                {reviewBlockedAction}
              </Button>
            )}
          </div>
        )}

        <InputBar
          conversationId={conversationId}
          isHosted={isHostedAgent}
          value={input}
          onChange={setInput}
          onSubmit={handleSubmit}
          onVoiceSend={handleVoiceSend}
          onStop={handleStop}
          disabled={streaming || !!shellTurnId || commandPending || reviewBlocked}
          streaming={streaming || !!shellTurnId}
          steerable={shellTurnId ? false : steerable}
          queueing={queueing}
          queueDelivery={queueDelivery}
          onSelectQueueDelivery={setQueueDelivery}
          queue={
            <PromptQueue
              items={queue.items}
              currentTodos={queue.items.length > 0 ? activeTodos : null}
              streaming={streaming}
              held={queue.held}
              onRemove={(id) => void queue.remove(id).catch((e) => storeSetError(conversationId, String(e)))}
              onReorder={(next) => void queue.reorder(next)}
              onSetDelivery={(id, delivery) => void queue.setDelivery(id, delivery)}
              onRelease={() => void queue.release()}
            />
          }
          assistants={settings.assistants}
          providers={settings.providers}
          currentAssistantId={settings.selectedAssistantId}
          currentModelId={settings.selectedModelId}
          currentProviderId={settings.selectedProviderId}
          onSelectAssistant={settings.onSelectAssistant}
          onSelectModel={settings.onSelectModel}
          thinkingLevel={settings.thinkingLevel}
          onSelectThinkingLevel={settings.onSelectThinkingLevel}
          fastMode={settings.fastMode}
          onToggleFast={settings.onToggleFast}
          mode={settings.mode}
          onSelectMode={settings.onSelectMode}
          acceptEdits={settings.acceptEdits}
          onToggleAcceptEdits={settings.onToggleAcceptEdits}
          capabilities={settings.capabilities}
          contextInfo={contextInfo}
          compacting={compacting}
          onCompact={() => handleCompact()}
          attachedFiles={attachedFiles}
          onAttachFiles={(files) => setAttachedFiles((prev) => [...prev, ...files])}
          onRemoveFile={(idx) => setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))}
          pendingSticker={pendingSticker}
          onSelectSticker={setPendingSticker}
          onRemoveSticker={() => setPendingSticker(null)}
        />
        {confirmDialog}
      </DropZone>
    </SubAgentSheetProvider>
  )
}

interface ChatViewProps {
  conversationId: string
  initialDraft?: InitialTurnDraft | null
  onInitialDraftConsumed?: () => void
  onCreate?: () => void | Promise<void>
  onOpenSettingsTab?: (tab: SettingsTab) => void
}

export function ChatView({
  conversationId,
  initialDraft,
  onInitialDraftConsumed,
  onCreate,
  onOpenSettingsTab,
}: ChatViewProps) {
  return (
    <ChatViewInner
      conversationId={conversationId}
      initialDraft={initialDraft}
      onInitialDraftConsumed={onInitialDraftConsumed}
      onCreate={onCreate}
      onOpenSettingsTab={onOpenSettingsTab}
    />
  )
}
