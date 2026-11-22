import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { TextArea } from '@/components/yuerchu-ui/components/text-area/text-area'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { SettingsGroup, SettingsRow } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { SettingsPage } from '../settings-page'
import { parseImportJson, type McpServersJson } from './import-json'

/**
 * Pasting another client's `mcpServers` document, as a page of its own.
 *
 * It used to be a form that appeared above the list in the detail column;
 * on a stack it is simply the next page, and Back is the cancel.
 */
export function McpImportPage({
  onImport,
  onCancel,
}: {
  onImport: (data: McpServersJson) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const errorId = useId()

  const handleSubmit = async () => {
    const data = parseImportJson(text)
    if (!data) {
      setError(t('settings.mcp.importJsonError'))
      return
    }
    setImporting(true)
    try {
      await onImport(data)
    } catch (reason) {
      setError(String(reason))
    } finally {
      setImporting(false)
    }
  }

  return (
    <SettingsPage
      title={t('settings.mcp.importJson')}
      subtitle={t('settings.mcp.importJsonHint')}
      footer={
        <>
          <Button size="sm" onPress={() => void handleSubmit()} isDisabled={!text.trim()} isPending={importing}>
            {t('settings.mcp.importJsonSubmit')}
          </Button>
          <Button size="sm" variant="secondary" onPress={onCancel}>
            {t('settings.mcp.importJsonCancel')}
          </Button>
        </>
      }
    >
      <SettingsGroup>
        <SettingsRow label={t('settings.mcp.importJsonLabel')}>
          <TextArea
            aria-describedby={error ? errorId : undefined}
            aria-invalid={error ? true : undefined}
            name="mcpImportJson"
            spellCheck="false"
            placeholder={t('settings.mcp.importJsonPlaceholder')}
            value={text}
            onChange={(event) => {
              setText(event)
              setError(null)
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                void handleSubmit()
              }
            }}
          />
        </SettingsRow>
      </SettingsGroup>
      {error && (
        <Alert id={errorId} data-slot="mcp-import-error" tone="danger" shouldAnnounce>
          {error}
        </Alert>
      )}
    </SettingsPage>
  )
}
