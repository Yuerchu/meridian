import { useTranslation } from 'react-i18next'
import { Input, Label, TextField } from '@heroui/react'

import { SettingsSelect } from './primitives'
import type { ModelInfo, Provider } from '@/types'

/** Stands for "whatever the caller falls back to" in the provider list. */
const NO_PROVIDER = '_default'
/** Stands for "not chosen" in the model list. */
const NO_MODEL = '_none'

type NameProps = { label: React.ReactNode; ariaLabel?: never } | { label?: never; ariaLabel: string }

interface ProviderModelPickerProps {
  providers: Provider[]
  /** Empty until a provider is chosen, and empty again if the fetch failed. */
  models: ModelInfo[]
  providerId: string
  modelId: string
  /**
   * The pair changed. Choosing a provider clears the model, which is why this
   * is one callback and not two — half a pair is not a state either caller
   * wants to hold.
   */
  onChange: (providerId: string, modelId: string) => void
  /**
   * The pair settled: a list item was picked, or the fallback field lost focus.
   *
   * Separate from `onChange` because one caller writes a preference here and
   * typing an id would otherwise write one per keystroke. A caller with a Save
   * button leaves it out.
   */
  onCommit?: (providerId: string, modelId: string) => void
  /** What the empty provider row says — "default", or "follow the parent". */
  emptyProviderLabel: string
  /** Visible labels, or names only a screen reader sees. */
  labelMode?: 'label' | 'aria'
  isModelDisabledWithoutProvider?: boolean
}

/**
 * The provider-and-model pair, including what to do when the model list is not
 * available.
 *
 * Both editors that needed this had written it out, and the second one's
 * comment said so: "the same fallback the assistant editor makes". The fallback
 * is the part worth sharing — a provider whose models have not been fetched
 * (or cannot be) still has to be usable, so the second control degrades to a
 * plain id field rather than to nothing.
 *
 * The two copies had drifted in one way worth keeping and one worth losing.
 * Kept: whether the model control is disabled before a provider is chosen.
 * Lost: one of them wrapped the fallback in a `TextField` and the other used a
 * bare `Input` with an `aria-label`, so its label and its control were only
 * related by proximity.
 */
export function ProviderModelPicker({
  providers,
  models,
  providerId,
  modelId,
  onChange,
  onCommit,
  emptyProviderLabel,
  labelMode = 'label',
  isModelDisabledWithoutProvider,
}: ProviderModelPickerProps) {
  const { t } = useTranslation()

  const name = (text: string): NameProps => (labelMode === 'aria' ? { ariaLabel: text } : { label: text })

  const providerOptions = [
    { value: NO_PROVIDER, label: emptyProviderLabel },
    ...providers.map((p) => ({ value: p.id, label: p.name })),
  ]
  const modelOptions = [
    { value: NO_MODEL, label: t('settings.assistant.selectModel') },
    ...models.map((m) => ({ value: m.id, label: m.name })),
  ]

  const pickProvider = (value: string) => {
    const next = value === NO_PROVIDER ? '' : value
    onChange(next, '')
    onCommit?.(next, '')
  }

  const pickModel = (value: string) => {
    const next = value === NO_MODEL ? '' : value
    onChange(providerId, next)
    onCommit?.(providerId, next)
  }

  return (
    <div data-slot="provider-model-picker" className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <SettingsSelect
        {...name(t('settings.assistant.provider'))}
        value={providerId || NO_PROVIDER}
        options={providerOptions}
        onChange={pickProvider}
        fullWidth
      />
      {models.length > 0 ? (
        <SettingsSelect
          {...name(t('settings.assistant.model'))}
          value={modelId || NO_MODEL}
          options={modelOptions}
          onChange={pickModel}
          placeholder={t('settings.assistant.selectModel')}
          isDisabled={isModelDisabledWithoutProvider && !providerId}
          fullWidth
        />
      ) : (
        <TextField
          fullWidth
          isDisabled={isModelDisabledWithoutProvider && !providerId}
          aria-label={labelMode === 'aria' ? t('settings.assistant.model') : undefined}
        >
          {labelMode === 'label' && <Label>{t('settings.assistant.model')}</Label>}
          <Input
            value={modelId}
            onChange={(e) => onChange(providerId, e.target.value)}
            onBlur={() => onCommit?.(providerId, modelId)}
            placeholder={t('settings.assistant.modelPlaceholder')}
          />
        </TextField>
      )}
    </div>
  )
}
