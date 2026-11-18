import { useTranslation } from 'react-i18next'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Bin, Plus } from '@keyline-icons/react/two-tone'
import { blankTier, type TierDraft } from './pricing'

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
  const patch = (index: number, field: Exclude<keyof TierDraft, 'id'>, value: string) =>
    onChange(tiers.map((tier, i) => (i === index ? { ...tier, [field]: value } : tier)))

  // Keyed by the tier's own id: by index, deleting a tier gave its card's
  // element to the next one, with focus still on the delete button — which
  // then deleted the tier that had been second.
  const remove = (index: number) => onChange(tiers.filter((_, i) => i !== index))
  const add = () => onChange([...tiers, blankTier()])

  return (
    <div data-slot="price-tiers" className="space-y-2">
      <p data-slot="price-tiers-hint" className="text-caption-1-regular text-text-secondary">
        {t('settings.model.priceTiersHint')}
      </p>
      {tiers.map((tier, index) => (
        <div
          key={tier.id}
          data-slot="price-tier"
          className="rounded-lg border border-border-button-default p-2 space-y-2"
        >
          <div data-slot="price-tier-header" className="flex items-end gap-2">
            <TextField
              label={t('settings.model.tierThreshold')}
              name={`${namePrefix}TierThreshold-${index}`}
              inputMode="numeric"
              value={tier.threshold}
              onChange={(e) => patch(index, 'threshold', e)}
              placeholder="200000"
            />
            <TooltipTrigger>
              <Button
                icon={<Bin />}
                size="sm"
                variant="ghost"
                aria-label={t('settings.model.removeTier')}
                className="touch-hitbox hover:text-status-danger"
                onPress={() => remove(index)}
              />
              <Tooltip>{t('settings.model.removeTier')}</Tooltip>
            </TooltipTrigger>
          </div>
          <div data-slot="price-tier-rates" className="grid grid-cols-1 @sm/pane:grid-cols-2 gap-2">
            <TextField
              label={t('settings.model.inputPrice')}
              name={`${namePrefix}TierInputPrice-${index}`}
              inputMode="decimal"
              value={tier.input}
              onChange={(e) => patch(index, 'input', e)}
            />
            <TextField
              label={t('settings.model.outputPrice')}
              name={`${namePrefix}TierOutputPrice-${index}`}
              inputMode="decimal"
              value={tier.output}
              onChange={(e) => patch(index, 'output', e)}
            />
            <TextField
              label={t('settings.model.cachePrice')}
              name={`${namePrefix}TierCacheReadPrice-${index}`}
              inputMode="decimal"
              value={tier.cacheRead}
              onChange={(e) => patch(index, 'cacheRead', e)}
              placeholder="—"
            />
            <TextField
              label={t('settings.model.cacheWritePrice')}
              name={`${namePrefix}TierCacheWritePrice-${index}`}
              inputMode="decimal"
              value={tier.cacheWrite}
              onChange={(e) => patch(index, 'cacheWrite', e)}
              placeholder="—"
            />
          </div>
        </div>
      ))}
      <Button
        icon={<Plus />}
        size="sm"
        variant="secondary"
        className="h-7 pointer-coarse:h-10 rounded-md text-caption-1-regular"
        onPress={add}
      >
        {t('settings.model.addTier')}
      </Button>
    </div>
  )
}
