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
import { isRemote } from '@/lib/transport'
import { titleIfTruncated } from '@/lib/truncation'

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
      <SettingsGroup heading={t('settings.emoji.embedderSection')} headingLevel={3}>
        <SettingsRow label={t('settings.emoji.embedder')} description={t('settings.emoji.embedderHint')}>
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
        </SettingsRow>
      </SettingsGroup>
      {error && (
        <Alert tone="danger" shouldAnnounce data-slot="emoji-embedder-error">
          {error}
        </Alert>
      )}
    </div>
  )
}
