import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button, TextArea } from '@/components/base'
import { SettingsCard, SettingsRow } from '../primitives'
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
          <Button size="small" onPress={() => void handleSubmit()} isDisabled={!text.trim()} isPending={importing}>
            {t('settings.mcp.importJsonSubmit')}
          </Button>
          <Button size="small" variant="secondary" onPress={onCancel}>
            {t('settings.mcp.importJsonCancel')}
          </Button>
        </>
      }
    >
      <SettingsCard data-slot="mcp-import-form">
        <SettingsRow
          label={t('settings.mcp.importJsonLabel')}
          stacked
          className="@sm/pane:flex-col @sm/pane:items-stretch"
        >
          {({ labelId }) => (
            <TextArea
              aria-labelledby={labelId}
              aria-describedby={error ? errorId : undefined}
              aria-invalid={error ? true : undefined}
              name="mcpImportJson"
              spellCheck={false}
              fieldClassName="w-full"
              className="h-48 font-mono"
              placeholder={t('settings.mcp.importJsonPlaceholder')}
              value={text}
              onChange={(event) => {
                setText(event.target.value)
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
          )}
        </SettingsRow>
      </SettingsCard>
      {error && (
        <p
          id={errorId}
          data-slot="mcp-import-error"
          role="alert"
          className="px-3 text-body-2-regular text-status-danger"
        >
          {error}
        </p>
      )}
    </SettingsPage>
  )
}
