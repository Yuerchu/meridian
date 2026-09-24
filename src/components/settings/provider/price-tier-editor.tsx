import { useTranslation } from 'react-i18next'
import { Button, Input, Label, TextField, Tooltip, TooltipTrigger } from '@/components/base'
import { Bin, Plus } from '@keyline-icons/react/two-tone'
import { BLANK_TIER, type TierDraft } from './pricing'

/**
 * The rates that take over above a prompt size.
 *
 * Laid out one tier per card rather than one per row: five numbers across the
 * detail pane would each be too narrow to read a price in, and this list is
 * nearly always empty or one entry long.
 */
export function PriceTierEditor({
  tiers,
  onChange,
  namePrefix = 'model',
}: {
  tiers: TierDraft[]
  onChange: (next: TierDraft[]) => void
  /** Distinguishes two editors on one page; a `name` has to be unique in a form. */
  namePrefix?: string
}) {
  const { t } = useTranslation()
  const patch = (index: number, field: keyof TierDraft, value: string) =>
    onChange(tiers.map((tier, i) => (i === index ? { ...tier, [field]: value } : tier)))

  return (
    <div data-slot="price-tiers" className="space-y-2">
      <p data-slot="price-tiers-hint" className="text-caption-1-regular text-text-secondary">
        {t('settings.model.priceTiersHint')}
      </p>
      {tiers.map((tier, index) => (
        <div
          key={index}
          data-slot="price-tier"
          className="rounded-lg border border-border-button-default p-2 space-y-2"
        >
          <div data-slot="price-tier-header" className="flex items-end gap-2">
            <TextField>
              <Label>{t('settings.model.tierThreshold')}</Label>
              <Input
                name={`${namePrefix}TierThreshold-${index}`}
                inputMode="numeric"
                value={tier.threshold}
                onChange={(e) => patch(index, 'threshold', e.target.value)}
                placeholder="200000"
                className="h-7 pointer-coarse:h-10 text-caption-1-regular"
              />
            </TextField>
            <TooltipTrigger>
              <Button
                iconOnly
                leadingIcon={Bin}
                size="small"
                variant="neutral"
                aria-label={t('settings.model.removeTier')}
                className="touch-hitbox hover:text-status-danger"
                onPress={() => onChange(tiers.filter((_, i) => i !== index))}
              />
              <Tooltip>{t('settings.model.removeTier')}</Tooltip>
            </TooltipTrigger>
          </div>
          <div data-slot="price-tier-rates" className="grid grid-cols-1 @sm/pane:grid-cols-2 gap-2">
            <TextField>
              <Label>{t('settings.model.inputPrice')}</Label>
              <Input
                name={`${namePrefix}TierInputPrice-${index}`}
                inputMode="decimal"
                value={tier.input}
                onChange={(e) => patch(index, 'input', e.target.value)}
                className="h-7 pointer-coarse:h-10 text-caption-1-regular"
              />
            </TextField>
            <TextField>
              <Label>{t('settings.model.outputPrice')}</Label>
              <Input
                name={`${namePrefix}TierOutputPrice-${index}`}
                inputMode="decimal"
                value={tier.output}
                onChange={(e) => patch(index, 'output', e.target.value)}
                className="h-7 pointer-coarse:h-10 text-caption-1-regular"
              />
            </TextField>
            <TextField>
              <Label>{t('settings.model.cachePrice')}</Label>
              <Input
                name={`${namePrefix}TierCacheReadPrice-${index}`}
                inputMode="decimal"
                value={tier.cacheRead}
                onChange={(e) => patch(index, 'cacheRead', e.target.value)}
                placeholder="—"
                className="h-7 pointer-coarse:h-10 text-caption-1-regular"
              />
            </TextField>
            <TextField>
              <Label>{t('settings.model.cacheWritePrice')}</Label>
              <Input
                name={`${namePrefix}TierCacheWritePrice-${index}`}
                inputMode="decimal"
                value={tier.cacheWrite}
                onChange={(e) => patch(index, 'cacheWrite', e.target.value)}
                placeholder="—"
                className="h-7 pointer-coarse:h-10 text-caption-1-regular"
              />
            </TextField>
          </div>
        </div>
      ))}
      <Button
        size="small"
        variant="secondary"
        className="h-7 pointer-coarse:h-10 rounded-md text-caption-1-regular"
        onPress={() => onChange([...tiers, { ...BLANK_TIER }])}
      >
        <Plus className="size-3.5" />
        {t('settings.model.addTier')}
      </Button>
    </div>
  )
}
