import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, X } from '@keyline-icons/react/two-tone'
import { open as dialogOpen } from '@tauri-apps/plugin-dialog'
import { Button, Tooltip, TooltipTrigger } from '@/components/base'
import { api } from '@/api'
import { isRemote } from '@/lib/transport'
import { titleIfTruncated } from '@/lib/truncation'
import { SettingsRow, SettingsSection } from './primitives'

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

  useEffect(() => {
    api
      .getPreference({ key: PREFERENCE_KEY })
      .then(({ value }) => {
        setPath(value)
        setReady(true)
      })
      .catch((reason) => setError(String(reason)))
  }, [])

  const persist = useCallback((next: string | null) => {
    setError(null)
    api
      .setPreference({ key: PREFERENCE_KEY, value: next })
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

  return (
    <div data-slot="emoji-embedder">
      <SettingsSection label={t('settings.emoji.embedderSection')}>
        <SettingsRow stacked label={t('settings.emoji.embedder')} description={t('settings.emoji.embedderHint')}>
          {({ labelId, descriptionId }) => (
            <>
              <p
                data-slot="emoji-embedder-path"
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                onPointerEnter={titleIfTruncated}
                className="min-w-0 flex-1 truncate text-body-2-regular text-text-secondary"
              >
                {ready ? (path ?? t('settings.emoji.embedderNone')) : '\u00a0'}
              </p>
              <Button size="small" variant="secondary" leadingIcon={FolderOpen} onPress={() => void handleBrowse()}>
                {t('settings.emoji.embedderBrowse')}
              </Button>
              {path !== null && (
                <TooltipTrigger delay={0}>
                  <Button
                    iconOnly
                    leadingIcon={X}
                    size="small"
                    variant="neutral"
                    aria-label={t('settings.emoji.embedderClear')}
                    onPress={() => persist(null)}
                  />
                  <Tooltip>{t('settings.emoji.embedderClear')}</Tooltip>
                </TooltipTrigger>
              )}
            </>
          )}
        </SettingsRow>
        {error && (
          <p
            data-slot="emoji-embedder-error"
            role="alert"
            className="px-3 pb-2.5 text-caption-1-regular text-status-danger break-all"
          >
            {error}
          </p>
        )}
      </SettingsSection>
    </div>
  )
}
