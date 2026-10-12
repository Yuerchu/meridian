import { useCallback, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button, Card, Chip, Sheet, Spinner } from '@/components/base'
import { EmptyState } from '@/components/base'
import { SquareArrowUpRight } from '@keyline-icons/react/two-tone'

import { api } from '@/api'
import type { TurnOrigin, UsageGapInfoResponse, UsageGapListResponse } from '@/types'

/**
 * The replies behind the usage page's two warnings — usage the provider did not
 * report, and usage nobody priced — one row each, with what is missing.
 *
 * A count with no way to the rows it counts is a number nobody can act on. Which
 * replies are listed is the backend's decision, made by the same accumulator
 * that produced the counts (`db::sea::ops::usage::gaps`); nothing here filters.
 */
export function UsageGapsSheet({
  isOpen,
  onOpenChange,
  sinceMs,
  origin,
  onOpenConversation,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  /** The window of the report whose warning was pressed, so the list explains that count. */
  sinceMs: number | null
  origin: TurnOrigin | null
  onOpenConversation: (conversationId: string) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const hintId = useId()
  const [found, setFound] = useState<UsageGapListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setFound(null)
    setError(null)
    api
      .usageGaps({ sinceMs, untilMs: null, origin, conversationId: null })
      .then(setFound)
      .catch((reason) => setError(String(reason)))
  }, [sinceMs, origin])

  useEffect(() => {
    if (isOpen) load()
  }, [isOpen, load])

  const time = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <Sheet isOpen={isOpen} onOpenChange={onOpenChange} placement="right">
      <Sheet.Backdrop>
        <Sheet.Content>
          <Sheet.Dialog
            aria-describedby={hintId}
            // Portalled, so no ancestor's inset reaches it.
            className="w-[28rem] max-w-[85vw] pb-[max(1.5rem,var(--safe-bottom))] pr-[max(1.5rem,var(--safe-right))]"
            data-slot="usage-gaps"
          >
            <Sheet.CloseTrigger aria-label={t('common.close')} />
            <Sheet.Header className="gap-1">
              <Sheet.Heading>{t('settings.usage.gaps.title')}</Sheet.Heading>
              <p id={hintId} className="text-body-regular text-text-secondary">
                {t('settings.usage.gaps.hint')}
              </p>
            </Sheet.Header>

            <Sheet.Body className="space-y-2">
              {error ? (
                <Alert status="danger" role="alert">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>{t('settings.usage.gaps.loadError')}</Alert.Description>
                    <Button size="small" variant="secondary" className="mt-2" onPress={load}>
                      {t('settings.usage.retry')}
                    </Button>
                  </Alert.Content>
                </Alert>
              ) : !found ? (
                <div role="status" aria-label={t('common.loading')} className="flex justify-center p-6">
                  <Spinner aria-hidden="true" />
                </div>
              ) : found.items.length === 0 ? (
                <EmptyState size="sm">
                  <EmptyState.Header>
                    <EmptyState.Title>{t('settings.usage.gaps.empty')}</EmptyState.Title>
                  </EmptyState.Header>
                </EmptyState>
              ) : (
                <>
                  {found.total > found.items.length && (
                    <p data-slot="usage-gaps-truncated" className="text-caption-1-regular text-text-secondary">
                      {t('settings.usage.gaps.truncated', { shown: found.items.length, total: found.total })}
                    </p>
                  )}
                  {found.items.map((gap) => (
                    <GapRow
                      key={gap.id}
                      gap={gap}
                      when={time.format(new Date(gap.created_at))}
                      onOpen={() => {
                        onOpenChange(false)
                        onOpenConversation(gap.conversation_id)
                      }}
                    />
                  ))}
                </>
              )}
            </Sheet.Body>
          </Sheet.Dialog>
        </Sheet.Content>
      </Sheet.Backdrop>
    </Sheet>
  )
}

function GapRow({ gap, when, onOpen }: { gap: UsageGapInfoResponse; when: string; onOpen: () => void }) {
  const { t } = useTranslation()
  const title =
    gap.conversation_title === null
      ? t('settings.usage.gaps.deleted')
      : gap.conversation_title || t('settings.usage.gaps.untitled')
  const reasons = [
    gap.missing_input && t('settings.usage.gaps.missingInput'),
    gap.missing_output && t('settings.usage.gaps.missingOutput'),
    gap.unpriced_tokens && t('settings.usage.gaps.unpricedTokens'),
    gap.unpriced_tools && t('settings.usage.gaps.unpricedTools'),
    gap.billing_mode !== 'metered' && t(`settings.usage.billing.${gap.billing_mode}`),
    gap.content_chars === 0 && t('settings.usage.gaps.empty_reply'),
  ].filter((reason): reason is string => Boolean(reason))
  const model = [gap.provider_name, gap.model_id].filter(Boolean).join(' · ')

  return (
    <Card data-slot="usage-gap-row" variant="secondary">
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-medium text-text-primary">{title}</p>
          <p className="text-caption-1-regular text-text-secondary">
            {when}
            {model && ` · ${model}`}
            {gap.role !== 'assistant' && ` · ${t(`settings.usage.gaps.role.${gap.role}`)}`}
          </p>
        </div>
        {gap.conversation_title !== null && (
          <Button
            variant="neutral"
            iconOnly
            leadingIcon={SquareArrowUpRight}
            size="small"
            aria-label={t('settings.usage.gaps.open')}
            onPress={onOpen}
          />
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {reasons.map((reason) => (
          <Chip key={reason}>{reason}</Chip>
        ))}
      </div>
    </Card>
  )
}
