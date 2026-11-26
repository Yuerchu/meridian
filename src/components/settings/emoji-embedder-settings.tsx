import './emoji-embedder-settings.css'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, X } from '@keyline-icons/react/two-tone'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { SettingsGroup, SettingsRow } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { api } from '@/api'
import { isRemote, listen } from '@/lib/transport'
import { titleIfTruncated } from '@/lib/truncation'
import type { EmojiEmbedderStatusResponse } from '@/types'

const PREFERENCE_KEY = 'emoji.embedder'

/**
 * On-device EmbeddingGemma 2 used to rank `send_sticker` queries.
 *
 * Not offered to a remote client: the backend refuses the key there
 * (`is_server_owned`), because the value is an absolute path on this machine.
 * Empty is the lexical name/tag pick, which is how send_sticker worked before
 * this existed.
 */
export function EmojiEmbedderSettings() {
  if (isRemote) return null
  return <EmojiEmbedderRow />
}

function EmojiEmbedderRow() {
  const { t } = useTranslation()
  const [path, setPath] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<EmojiEmbedderStatusResponse | null>(null)

  useEffect(() => {
    api.preferences
      .get({ key: PREFERENCE_KEY })
      .then(({ value }) => {
        setPath(value)
        setReady(true)
      })
      .catch((reason) => setError(String(reason)))
  }, [])

  useEffect(() => {
    let active = true
    let unlisten: (() => void) | undefined
    api.emojis
      .getEmbedderStatus()
      .then((next) => {
        if (active) setStatus(next)
      })
      .catch(() => {})
    void listen('emoji-embedder-updated', ({ payload }) => {
      if (active) setStatus(payload)
    })
      .then((off) => {
        if (active) unlisten = off
        else off()
      })
      .catch(() => {})
    return () => {
      active = false
      unlisten?.()
    }
  }, [])

  const persist = useCallback((next: string | null) => {
    setError(null)
    api.preferences
      .set({ key: PREFERENCE_KEY, value: next })
      .then(() => setPath(next))
      .catch((reason) => setError(String(reason)))
  }, [])

  const handleBrowse = async () => {
    setError(null)
    const file = await dialogOpen({
      multiple: false,
      filters: [{ name: 'LiteRT-LM model', extensions: ['litertlm'] }],
    }).catch(() => null)
    if (typeof file === 'string') persist(file)
  }

  const statusText = (() => {
    if (!status || status.state === 'disabled' || status.state === 'error') return null
    if (status.state === 'loading') return t('settings.emoji.embedderStatus.loading')
    if (status.state === 'indexing') {
      return t('settings.emoji.embedderStatus.indexing', {
        indexed: status.indexed,
        total: status.total,
      })
    }
    return t(status.vision ? 'settings.emoji.embedderStatus.readyVision' : 'settings.emoji.embedderStatus.readyText', {
      count: status.indexed,
    })
  })()

  const statusError =
    status?.state === 'error'
      ? status.error
        ? t('settings.emoji.embedderStatus.error', { error: status.error })
        : t('settings.emoji.embedderStatus.errorGeneric')
      : null

  const alertMessage = error ?? statusError

  return (
    <div data-slot="emoji-embedder">
      <SettingsGroup heading={t('settings.emoji.embedderSection')} headingLevel={3}>
        <SettingsRow label={t('settings.emoji.embedder')} description={t('settings.emoji.embedderHint')}>
          <div className="m-emoji-embedder__control">
            <div className="m-emoji-embedder__value">
              <p data-slot="emoji-embedder-path" onPointerEnter={titleIfTruncated} className="m-emoji-embedder__path">
                {ready ? (path ?? t('settings.emoji.embedderNone')) : ' '}
              </p>
              <Button size="sm" variant="secondary" icon={<FolderOpen />} onPress={() => void handleBrowse()}>
                {t('settings.emoji.embedderBrowse')}
              </Button>
              {path !== null && (
                <TooltipTrigger>
                  <Button
                    icon={<X />}
                    size="sm"
                    variant="ghost"
                    aria-label={t('settings.emoji.embedderClear')}
                    onPress={() => persist(null)}
                  />
                  <Tooltip>{t('settings.emoji.embedderClear')}</Tooltip>
                </TooltipTrigger>
              )}
            </div>
            {statusText !== null && (
              <p data-slot="emoji-embedder-status" aria-live="polite" className="m-emoji-embedder__status">
                {statusText}
              </p>
            )}
          </div>
        </SettingsRow>
      </SettingsGroup>
      {alertMessage && (
        <Alert tone="danger" shouldAnnounce data-slot="emoji-embedder-error">
          {alertMessage}
        </Alert>
      )}
    </div>
  )
}
