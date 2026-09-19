import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EmptyState as ProEmptyState } from '@/components/base'
import { PromptSuggestion } from '@/components/base'

import { useIsOffline } from '@/hooks/use-connection-state'
import { usePlatform } from '@/hooks/use-platform'
import { useTurnSettings } from '@/hooks/use-turn-settings'
import { visibleSettingsTabs, type SettingsTab } from '@/components/settings/tabs'
import { findComposerCommand } from '@/lib/composer-commands'
import { parseComposerIntent } from '@/lib/composer-intent'
import type { InitialTurnDraft } from './conversation-draft'
import { InputBar, type AttachedFile, type PendingSticker } from './input-bar'

const STARTER_PROMPT_KEYS = [
  'chat.empty.suggestions.review',
  'chat.empty.suggestions.plan',
  'chat.empty.suggestions.explain',
  'chat.empty.suggestions.write',
] as const

export function StarterPrompts({ disabled, onSelect }: { disabled?: boolean; onSelect: (prompt: string) => void }) {
  const { t } = useTranslation()

  return (
    <PromptSuggestion>
      <PromptSuggestion.Items>
        {STARTER_PROMPT_KEYS.map((key) => (
          <PromptSuggestion.Item key={key} disabled={disabled} onClick={() => onSelect(t(key))}>
            {t(key)}
          </PromptSuggestion.Item>
        ))}
      </PromptSuggestion.Items>
    </PromptSuggestion>
  )
}

interface EmptyStateProps {
  onSubmit: (draft: InitialTurnDraft) => Promise<void>
  onCreate: () => void | Promise<void>
  onOpenSettingsTab: (tab: SettingsTab) => void
  disabled?: boolean
  activeProjectId?: string | null
}

export function EmptyState({ onSubmit, onCreate, onOpenSettingsTab, disabled, activeProjectId }: EmptyStateProps) {
  const { t } = useTranslation()
  const platform = usePlatform()
  const [value, setValue] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [pendingSticker, setPendingSticker] = useState<PendingSticker | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const settings = useTurnSettings(null)
  // The same rule as the composer in a conversation: creating one on a machine
  // that is not answering fails, so the field does not pretend otherwise.
  const offline = useIsOffline()
  const locked = disabled || offline || submitting

  const submitDraft = useCallback(
    (text: string, voice = false) => {
      const trimmed = text.trim()
      const sticker = voice ? null : pendingSticker
      if ((!trimmed && !sticker) || locked) return

      // Commands that do not need a conversation are resolved while the
      // welcome composer still owns the draft. Sending them through
      // `onSubmit` would create an empty conversation merely to open settings
      // or show help. `/new` is the converse: creating once is already its full
      // meaning on a screen with no active conversation.
      if (!voice && attachedFiles.length === 0 && !sticker) {
        const intent = parseComposerIntent(trimmed)
        if (intent.kind === 'slash') {
          const context = {
            hasConversation: false,
            isHosted: false,
            supportsFast: settings.capabilities?.supports_fast === true,
          }
          const available = findComposerCommand(intent.name, context)
          const afterCreate = available ?? findComposerCommand(intent.name, { ...context, hasConversation: true })

          if (!afterCreate) {
            setSubmitError(t('chat.command.unknown', { name: intent.name }))
            return
          }
          if (available?.id === 'help') {
            setValue('/')
            setSubmitError(null)
            return
          }
          if (available?.id === 'settings') {
            const tab = intent.args
              ? visibleSettingsTabs(platform).find(
                  (candidate) => candidate.id.toLowerCase() === intent.args.toLowerCase(),
                )?.id
              : 'provider'
            if (!tab) {
              setSubmitError(t('chat.command.invalidArgument', { name: available.name, value: intent.args }))
              return
            }
            setValue('')
            setSubmitError(null)
            onOpenSettingsTab(tab)
            return
          }
          if (afterCreate.id === 'new') {
            setSubmitting(true)
            setSubmitError(null)
            void Promise.resolve()
              .then(onCreate)
              .catch((err) => {
                console.error('Failed to create conversation', err)
                setSubmitError(String(err))
              })
              .finally(() => setSubmitting(false))
            return
          }
        }
      }

      setSubmitting(true)
      setSubmitError(null)
      void Promise.resolve()
        .then(() =>
          onSubmit({
            text: trimmed,
            // Match an existing conversation: voice is a direct turn and does
            // not consume files or a sticker waiting in the typed composer.
            attachedFiles: voice ? [] : [...attachedFiles],
            pendingSticker: sticker,
            voice,
            remainingComposer:
              voice && (value || attachedFiles.length > 0 || pendingSticker)
                ? {
                    text: value,
                    attachedFiles: [...attachedFiles],
                    pendingSticker,
                  }
                : null,
            settings: {
              selectedAssistantId: settings.selectedAssistantId,
              selectedModelId: settings.selectedModelId,
              selectedProviderId: settings.selectedProviderId,
              thinkingLevel: settings.thinkingLevel,
              fastMode: settings.fastMode,
              mode: settings.mode,
              acceptEdits: settings.acceptEdits,
            },
          }),
        )
        // Creation errors leave the welcome composer and all of its draft
        // state in place. Show the failure here because there is no transcript
        // yet to own the normal conversation error row.
        .catch((err) => {
          console.error('Failed to create conversation', err)
          setSubmitError(String(err))
        })
        .finally(() => setSubmitting(false))
    },
    [
      attachedFiles,
      locked,
      onCreate,
      onOpenSettingsTab,
      onSubmit,
      pendingSticker,
      platform,
      settings.acceptEdits,
      settings.capabilities,
      settings.fastMode,
      settings.mode,
      settings.selectedAssistantId,
      settings.selectedModelId,
      settings.selectedProviderId,
      settings.thinkingLevel,
      t,
      value,
    ],
  )

  const handleSubmit = useCallback(() => submitDraft(value), [submitDraft, value])
  const handleVoiceSend = useCallback((text: string) => submitDraft(text, true), [submitDraft])
  const handleValueChange = useCallback((next: string) => {
    setValue(next)
    setSubmitError(null)
  }, [])

  return (
    <div data-slot="empty-state" className="flex h-full overflow-y-auto px-4">
      <ProEmptyState size="lg" className="mx-auto my-auto w-full max-w-2xl gap-6 px-0 py-8">
        <ProEmptyState.Header>
          <ProEmptyState.Title className="text-title-2-medium">{t('chat.empty.subtitle')}</ProEmptyState.Title>
        </ProEmptyState.Header>
        <ProEmptyState.Content className="w-full gap-4">
          <InputBar
            embedded
            conversationId={null}
            workspaceProjectId={activeProjectId}
            value={value}
            onChange={handleValueChange}
            onSubmit={handleSubmit}
            onVoiceSend={handleVoiceSend}
            disabled={locked}
            pending={submitting}
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
            attachedFiles={attachedFiles}
            onAttachFiles={(files) => setAttachedFiles((current) => [...current, ...files])}
            onRemoveFile={(index) => setAttachedFiles((current) => current.filter((_, i) => i !== index))}
            pendingSticker={pendingSticker}
            onSelectSticker={setPendingSticker}
            onRemoveSticker={() => setPendingSticker(null)}
          />
          {submitError && (
            <p
              data-slot="empty-state-error"
              role="alert"
              className="break-words px-2 text-caption-1-regular text-status-danger"
            >
              {submitError}
            </p>
          )}
          <StarterPrompts disabled={locked} onSelect={handleValueChange} />
        </ProEmptyState.Content>
      </ProEmptyState>
    </div>
  )
}
