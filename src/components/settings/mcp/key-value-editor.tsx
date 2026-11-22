import './key-value-editor.css'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Bin } from '@keyline-icons/react/two-tone'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { PasswordField } from '@/components/yuerchu-ui/components/password-field/password-field'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { SettingsAddRow, SettingsSectionLabel } from '../primitives'
import { SettingsGroup } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { newPair, type KeyValuePair } from './key-value'

/**
 * Request headers or environment variables, as rows rather than a JSON blob.
 *
 * Both routinely hold a credential — `Authorization: Bearer …`, an
 * `API_KEY=` — and a single-line JSON field showed it in full to anyone
 * looking at the screen. Each value is masked until its own reveal button is
 * pressed. The names stay visible: they are what you scan for.
 */
export function KeyValueEditor({
  label,
  description,
  addLabel,
  keyPlaceholder,
  pairs,
  onChange,
}: {
  label: string
  description?: string
  addLabel: string
  keyPlaceholder: string
  pairs: KeyValuePair[]
  onChange: (pairs: KeyValuePair[]) => void
}) {
  const { t } = useTranslation()
  const headingId = useId()

  const update = (id: string, patch: Partial<Omit<KeyValuePair, 'id'>>) =>
    onChange(pairs.map((pair) => (pair.id === id ? { ...pair, ...patch } : pair)))

  return (
    <section data-slot="mcp-kv-section" aria-labelledby={headingId} className="m-kv-editor">
      <div data-slot="mcp-kv-bar" className="m-kv-editor__bar">
        <div data-slot="mcp-kv-heading" className="m-kv-editor__heading">
          <SettingsSectionLabel id={headingId}>{label}</SettingsSectionLabel>
          {description && (
            <p data-slot="mcp-kv-description" className="m-kv-editor__description">
              {description}
            </p>
          )}
        </div>
      </div>
      <SettingsGroup>
        {pairs.map((pair, index) => (
          <div key={pair.id} data-slot="mcp-kv-row" className="m-kv-editor__row">
            <TextField
              data-slot="mcp-kv-key"
              aria-label={t('settings.mcp.kv.keyLabel', { index: index + 1 })}
              autoComplete="off"
              spellCheck="false"
              value={pair.key}
              placeholder={keyPlaceholder}
              onChange={(event) => update(pair.id, { key: event })}
              className="m-kv-editor__key"
            />
            {/* Each value reveals on its own (the library's PasswordField); a
                header toggle showing every secret at once is gone. */}
            <PasswordField
              data-slot="mcp-kv-value"
              aria-label={t('settings.mcp.kv.valueLabel', { index: index + 1 })}
              // A secret, not an account password; the library has no purpose for it yet (Yuerchu/ui#570).
              autoComplete="current-password"
              value={pair.value}
              placeholder={t('settings.mcp.kv.valuePlaceholder')}
              onChange={(value) => update(pair.id, { value })}
              className="m-kv-editor__value"
            />
            <TooltipTrigger>
              <Button
                data-slot="mcp-kv-remove"
                size="sm"
                variant="ghost"
                icon={<Bin />}
                aria-label={t('settings.mcp.kv.remove', { index: index + 1 })}
                onPress={() => onChange(pairs.filter((candidate) => candidate.id !== pair.id))}
              />
              <Tooltip placement="top">{t('settings.mcp.kv.removeShort')}</Tooltip>
            </TooltipTrigger>
          </div>
        ))}
        <SettingsAddRow label={addLabel} onPress={() => onChange([...pairs, newPair()])} />
      </SettingsGroup>
    </section>
  )
}
