import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bin, Eye, EyeOff } from '@keyline-icons/react/two-tone'
import { Button, Input, Tooltip, TooltipTrigger } from '@/components/base'
import { SettingsAddRow, SettingsCard, SettingsSectionLabel } from '../primitives'
import { newPair, type KeyValuePair } from './key-value'

/**
 * Request headers or environment variables, as rows rather than a JSON blob.
 *
 * Both routinely hold a credential — `Authorization: Bearer …`, an
 * `API_KEY=` — and a single-line JSON field showed it in full to anyone
 * looking at the screen. So values are masked until asked for, with one
 * switch for the whole map at the end of the section's label line, where
 * settings-tools.tsx puts a section's own action. The names stay visible:
 * they are what you scan for.
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
  const [revealed, setRevealed] = useState(false)
  const headingId = useId()
  const toggleLabel = revealed ? t('settings.mcp.kv.hideValues') : t('settings.mcp.kv.showValues')

  const update = (id: string, patch: Partial<Omit<KeyValuePair, 'id'>>) =>
    onChange(pairs.map((pair) => (pair.id === id ? { ...pair, ...patch } : pair)))

  return (
    <section data-slot="mcp-kv-section" aria-labelledby={headingId} className="flex w-full flex-col gap-2">
      <div data-slot="mcp-kv-bar" className="flex items-end justify-between gap-3">
        <div data-slot="mcp-kv-heading" className="flex min-w-0 flex-col gap-0.5">
          <SettingsSectionLabel id={headingId}>{label}</SettingsSectionLabel>
          {description && (
            <p data-slot="mcp-kv-description" className="w-full px-3 text-body-2-regular text-text-secondary">
              {description}
            </p>
          )}
        </div>
        {pairs.length > 0 && (
          <TooltipTrigger delay={0}>
            <Button
              data-slot="mcp-kv-reveal"
              iconOnly
              size="small"
              variant="neutral"
              leadingIcon={revealed ? EyeOff : Eye}
              aria-label={toggleLabel}
              aria-pressed={revealed}
              onPress={() => setRevealed((value) => !value)}
            />
            <Tooltip placement="top">{toggleLabel}</Tooltip>
          </TooltipTrigger>
        )}
      </div>
      <SettingsCard>
        {pairs.map((pair, index) => (
          <div
            key={pair.id}
            data-slot="mcp-kv-row"
            className="flex w-full items-center gap-2 border-b border-separator-border py-2 pr-2.5"
          >
            <Input
              data-slot="mcp-kv-key"
              aria-label={t('settings.mcp.kv.keyLabel', { index: index + 1 })}
              autoComplete="off"
              spellCheck={false}
              value={pair.key}
              placeholder={keyPlaceholder}
              onChange={(event) => update(pair.id, { key: event.target.value })}
              fieldClassName="min-w-0 flex-[2]"
              className="font-mono"
            />
            <Input
              data-slot="mcp-kv-value"
              aria-label={t('settings.mcp.kv.valueLabel', { index: index + 1 })}
              type={revealed ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={pair.value}
              placeholder={t('settings.mcp.kv.valuePlaceholder')}
              onChange={(event) => update(pair.id, { value: event.target.value })}
              fieldClassName="min-w-0 flex-[3]"
              className="font-mono"
            />
            <TooltipTrigger delay={0}>
              <Button
                data-slot="mcp-kv-remove"
                iconOnly
                size="small"
                variant="neutral"
                leadingIcon={Bin}
                aria-label={t('settings.mcp.kv.remove', { index: index + 1 })}
                onPress={() => onChange(pairs.filter((candidate) => candidate.id !== pair.id))}
              />
              <Tooltip placement="top">{t('settings.mcp.kv.removeShort')}</Tooltip>
            </TooltipTrigger>
          </div>
        ))}
        <SettingsAddRow label={addLabel} onPress={() => onChange([...pairs, newPair()])} />
      </SettingsCard>
    </section>
  )
}
