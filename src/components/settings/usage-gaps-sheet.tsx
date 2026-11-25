import './usage-gaps-sheet.css'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Spinner } from '@/components/yuerchu-ui/components/spinner/spinner'
import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Dialog } from '@/components/yuerchu-ui/components/dialog/dialog'
import { EmptyState } from '@/components/yuerchu-ui/components/empty-state/empty-state'
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
  const [found, setFound] = useState<UsageGapListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    setFound(null)
    setError(null)
    api.usage
      .listGaps({ since_ms: sinceMs, until_ms: null, origin, conversation_id: null })
      .then(setFound)
      .catch((reason) => setError(String(reason)))
  }, [sinceMs, origin])

  useEffect(() => {
    if (isOpen) load()
  }, [isOpen, load])

  const time = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      heading={t('settings.usage.gaps.title')}
      description={t('settings.usage.gaps.hint')}
    >
      <div data-slot="usage-gaps" className="m-usage-gaps__list">
        {error ? (
          <Alert
            tone="danger"
            shouldAnnounce
            actions={
              <Button size="sm" variant="secondary" onPress={load}>
                {t('settings.usage.retry')}
              </Button>
            }
          >
            {t('settings.usage.gaps.loadError')}
          </Alert>
        ) : !found ? (
          <div role="status" aria-label={t('common.loading')} className="m-usage-gaps__loading">
            <span aria-hidden>
              <Spinner />
            </span>
          </div>
        ) : found.items.length === 0 ? (
          <EmptyState heading={t('settings.usage.gaps.empty')} headingLevel={3} size="sm" />
        ) : (
          <>
            {found.total > found.items.length && (
              <p data-slot="usage-gaps-truncated" className="m-usage-gaps__note">
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
      </div>
    </Dialog>
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
    <article data-slot="usage-gap-row" className="m-usage-gaps__row">
      <div className="m-usage-gaps__head">
        <div className="m-usage-gaps__text">
          <p className="m-usage-gaps__title">{title}</p>
          <p className="m-usage-gaps__meta">
            {when}
            {model && ` · ${model}`}
            {gap.role !== 'assistant' && ` · ${t(`settings.usage.gaps.role.${gap.role}`)}`}
          </p>
        </div>
        {gap.conversation_title !== null && (
          <Button
            variant="ghost"
            icon={<SquareArrowUpRight />}
            size="sm"
            aria-label={t('settings.usage.gaps.open')}
            onPress={onOpen}
          />
        )}
      </div>
      <div className="m-usage-gaps__reasons">
        {reasons.map((reason) => (
          <Badge key={reason}>{reason}</Badge>
        ))}
      </div>
    </article>
  )
}
