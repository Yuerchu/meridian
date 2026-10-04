import type { TFunction } from 'i18next'
import type { AcpConfigOptionInfoResponse, AcpConfigOptionValueInfoResponse } from '@/types'

/**
 * What to call a knob, and what to call the value it is set to.
 *
 * The agent's own strings are English and always will be: `name` is composed in
 * the adapter, so in a Chinese window a row of them reads `Mode / Effort / Fast
 * mode` with nothing translated. The ids it uses for the knobs it defines are a
 * short documented set (`mode`, `model`, `effort`, `fast`, `agent`), so those
 * get translations here and everything else falls back to what the agent said —
 * which is the only right answer for a knob some other agent invented.
 *
 * Keyed on `id` rather than `category`, and that is not interchangeable: the
 * reasoning knob is `id: "effort"` under `category: "thought_level"`, and Fast
 * mode is `id: "fast"` under `category: "model_config"` — a category naming a
 * *class* of setting rather than the setting. Only the id names the thing.
 */
export function knobName(t: TFunction, option: AcpConfigOptionInfoResponse): string {
  const fallback = option.name || option.id
  return t(`chat.acp.knob.${option.id.toLowerCase()}`, { defaultValue: fallback })
}

export function knobValueName(
  t: TFunction,
  option: AcpConfigOptionInfoResponse,
  value: AcpConfigOptionValueInfoResponse,
): string {
  const fallback = value.name || value.value
  // Scoped per knob, because `default` means a different thing on each of them
  // and a model id must never find a translation at all.
  return t(`chat.acp.value.${option.id.toLowerCase()}.${value.value.toLowerCase()}`, { defaultValue: fallback })
}

export function currentValueName(t: TFunction, option: AcpConfigOptionInfoResponse): string | null {
  if (typeof option.currentValue !== 'string') return null
  const value = option.options.find((v) => v.value === option.currentValue)
  return value ? knobValueName(t, option, value) : option.currentValue
}

/**
 * Which of a hosted session's knobs is which, read by id or by category so an
 * agent that names one and omits the other is still understood. `thought_level`
 * is the category the adapter files effort under; `effort` is its id.
 */
export function isModelKnob(option: AcpConfigOptionInfoResponse): boolean {
  return option.id === 'model' || option.category === 'model'
}

export function isEffortKnob(option: AcpConfigOptionInfoResponse): boolean {
  return option.id === 'effort' || option.category === 'thought_level'
}

export function isModeKnob(option: AcpConfigOptionInfoResponse): boolean {
  return option.id === 'mode' || option.category === 'mode'
}
