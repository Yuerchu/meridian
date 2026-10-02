import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Alert,
  Button,
  Chip,
  ItemCard,
  ItemCardGroup,
  SearchField,
  Separator,
  Spinner,
  Tooltip,
  TooltipTrigger,
} from '@/components/base'
import { Bin } from '@keyline-icons/react/two-tone'

import { api } from '@/api'
import { useConfirm } from '@/hooks/use-confirm'
import type { ImeLearnedWordInfoResponse, ImeLearningInfoResponse } from '@/types'
import { titleIfTruncated } from '@/lib/truncation'

/** Rows drawn at once; the search narrows the rest. */
const SHOWN = 100

/**
 * What the input method learned from the person's typing, and the way to
 * make it forget some or all of it.
 *
 * Nothing here writes the learned files: they belong to the keyboard, which
 * holds them in memory and would write over any edit made here. Forgetting
 * files a request the keyboard carries out — within a second on Windows while
 * the host runs, the next time the keyboard comes up on Android — and the
 * list already leaves out what is waiting.
 */
export function ImeLearningSection() {
  const { t } = useTranslation()
  const { confirm, confirmDialog } = useConfirm()
  const [learning, setLearning] = useState<ImeLearningInfoResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setLearning(await api.getImeLearning())
    } catch (err) {
      setError(String(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const matching = useMemo(() => {
    const words = learning?.words ?? []
    const q = query.trim()
    return q ? words.filter((w) => w.text.includes(q)) : words
  }, [learning, query])

  const handleForget = async (word: ImeLearnedWordInfoResponse) => {
    setError(null)
    try {
      setLearning(await api.forgetImeLearnedWord({ text: word.text }))
    } catch (err) {
      setError(String(err))
    }
  }

  const handleForgetAll = async () => {
    if (!(await confirm({ body: t('settings.ime.learned.forgetAllConfirm'), status: 'danger' }))) return
    setError(null)
    setBusy(true)
    try {
      setLearning(await api.forgetAllImeLearning())
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div data-slot="ime-learned" className="space-y-1.5">
      <div data-slot="ime-learned-head" className="flex items-center justify-between gap-3">
        <p data-slot="ime-learned-summary" className="text-caption-1-medium text-text-secondary">
          {learning === null
            ? t('settings.ime.learned.title')
            : t('settings.ime.learned.summary', { words: learning.words.length, transitions: learning.transitions })}
        </p>
        {learning !== null && (learning.words.length > 0 || learning.transitions > 0) && (
          <Button size="small" variant="secondary" onPress={() => setOpen(!open)}>
            {open ? t('settings.ime.learned.close') : t('settings.ime.learned.manage')}
          </Button>
        )}
      </div>

      {learning === null && !error && (
        <p data-slot="ime-learned-loading" role="status" className="flex items-center gap-2">
          <Spinner size="sm" />
        </p>
      )}

      {error && (
        <Alert status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {learning !== null && learning.pending > 0 && (
        <p data-slot="ime-learned-pending" className="text-caption-1-regular text-text-secondary">
          {t('settings.ime.learned.pending')}
        </p>
      )}

      {open && learning !== null && (
        <div data-slot="ime-learned-list" className="space-y-2">
          <SearchField aria-label={t('settings.ime.learned.search')} value={query} onChange={setQuery}>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder={t('settings.ime.learned.search')} />
              <SearchField.ClearButton aria-label={t('settings.ime.learned.clearSearch')} />
            </SearchField.Group>
          </SearchField>

          {matching.length === 0 ? (
            <p data-slot="ime-learned-none" className="text-caption-1-regular text-text-secondary">
              {t('settings.ime.learned.none')}
            </p>
          ) : (
            <ItemCardGroup variant="outline">
              {matching.slice(0, SHOWN).map((word, index) => (
                <Fragment key={word.text}>
                  {index > 0 && <Separator />}
                  <ItemCard>
                    <ItemCard.Content className="min-w-0">
                      <ItemCard.Title className="flex w-full items-center gap-2">
                        <span data-slot="ime-learned-word" onPointerEnter={titleIfTruncated} className="truncate">
                          {word.text}
                        </span>
                        {word.user_word && (
                          <Chip size="sm" variant="soft">
                            {t('settings.ime.learned.userWord')}
                          </Chip>
                        )}
                      </ItemCard.Title>
                      <ItemCard.Description>
                        {t('settings.ime.learned.count', { count: word.count })}
                      </ItemCard.Description>
                    </ItemCard.Content>
                    <ItemCard.Action>
                      <TooltipTrigger delay={0}>
                        <Button
                          iconOnly
                          leadingIcon={Bin}
                          size="small"
                          variant="neutral"
                          aria-label={t('settings.ime.learned.forget', { word: word.text })}
                          onPress={() => handleForget(word)}
                        />
                        <Tooltip>{t('settings.ime.learned.forget', { word: word.text })}</Tooltip>
                      </TooltipTrigger>
                    </ItemCard.Action>
                  </ItemCard>
                </Fragment>
              ))}
            </ItemCardGroup>
          )}
          {matching.length > SHOWN && (
            <p data-slot="ime-learned-more" className="text-caption-1-regular text-text-secondary">
              {t('settings.ime.learned.more', { count: matching.length - SHOWN })}
            </p>
          )}

          <Button variant="danger" size="small" onPress={handleForgetAll} isDisabled={busy} isPending={busy}>
            {t('settings.ime.learned.forgetAll')}
          </Button>
        </div>
      )}
      {confirmDialog}
    </div>
  )
}
