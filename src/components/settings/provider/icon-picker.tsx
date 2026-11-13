import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input, ListBox, Sheet } from '@/components/base'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { ProviderMark } from '@/components/ui/provider-icon'

/** The one key that is not a key: putting the mark back to whatever the catalog says. */
const FOLLOW_VENDOR = 'default'

/**
 * Every logo the icon set knows, once the sheet has been opened.
 *
 * Loaded from the enum module, not the package entry: the barrel re-exports
 * `ModelTag`/`ProviderCombine` and a production build fails on their
 * `@lobehub/ui/base-ui` imports (see `model-icon.tsx`). The enum is a plain
 * object, so opening the picker does not pull the ~1.9 MB of logos. Reaching
 * for it eagerly would still cost a settings-page import for a list almost
 * nobody opens.
 *
 * Sorted here rather than at the call site because the set's own order is its
 * source order, which is neither alphabetical nor stable between releases.
 */
function useIconNames(enabled: boolean): string[] {
  const [names, setNames] = useState<string[]>([])
  useEffect(() => {
    if (!enabled || names.length > 0) return
    let cancelled = false
    void import('@lobehub/icons/es/features/providerEnum')
      .then((module) => {
        if (!cancelled) setNames(Object.values(module.ModelProvider).sort())
      })
      .catch((error) => console.error('Failed to load the icon set:', error))
    return () => {
      cancelled = true
    }
  }, [enabled, names.length])
  return names
}

/**
 * Which logo a provider draws.
 *
 * A row reaching Claude through Vertex, or any relay at all, names no vendor
 * the catalog knows, so it drew a generic cloud with no way to say otherwise —
 * which is what this is for. The chosen value is a name in the icon set and
 * decides nothing else: no adapter, no address, no credential reads it.
 *
 * `null` is the default and a real answer rather than an empty one — it means
 * "derive the mark from the vendor", which is what every row did before the
 * column existed and what a row naming a catalogued vendor still wants.
 */
export function ProviderIconPicker({
  value,
  catalogId,
  providerType,
  onChange,
  labelledBy,
}: {
  value: string | null
  catalogId: string | null
  providerType: string
  onChange: (icon: string | null) => void
  labelledBy?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const names = useIconNames(open)

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase()
    return query ? names.filter((name) => name.includes(query)) : names
  }, [names, filter])

  return (
    <>
      <Button
        data-slot="provider-icon-trigger"
        variant="secondary"
        aria-labelledby={labelledBy}
        onPress={() => setOpen(true)}
        className="w-[202px] justify-start"
      >
        {/* Button puts its children in one label span, so the button's own
            gap never reaches between the mark and the name. */}
        <span data-slot="provider-icon-trigger-content" className="flex min-w-0 items-center gap-1.5">
          <ProviderMark icon={value} catalogId={catalogId} providerType={providerType} size={16} />
          <span data-slot="provider-icon-trigger-label" className="truncate">
            {value ?? t('settings.provider.iconDefault')}
          </span>
        </span>
      </Button>
      <Sheet
        isOpen={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setFilter('')
        }}
        placement="bottom"
      >
        <Sheet.Backdrop>
          {/* The modal surface (`MODAL_SURFACE` is `background-full`), not the
            sheet's default `background-primary`: a field's tertiary well is the same
            neutral-800 as primary in dark, so on the default the field had no edge. */}
          <Sheet.Content className="mx-auto bg-background-full sm:max-w-lg sm:rounded-b-2xl">
            <Sheet.Dialog aria-label={t('settings.provider.iconChoose')} className="pb-[max(1rem,var(--safe-bottom))]">
              <Sheet.Handle />
              <Sheet.Header>
                <Sheet.Heading>{t('settings.provider.iconChoose')}</Sheet.Heading>
              </Sheet.Header>
              <Sheet.Body className="space-y-3">
                <Input
                  aria-label={t('settings.provider.iconFilter')}
                  name="providerIconFilter"
                  autoComplete="off"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder={t('settings.provider.iconFilter')}
                />
                {/* The grid scrolls rather than the sheet: the filter box has
                    to stay reachable while a hundred and fifty marks go past,
                    and `data-sheet-no-drag` is what stops a downward flick
                    inside it from closing the sheet instead of scrolling. */}
                <ListBox
                  aria-label={t('settings.provider.iconChoose')}
                  layout="grid"
                  selectionMode="single"
                  data-sheet-no-drag
                  selectedKeys={[value ?? FOLLOW_VENDOR]}
                  onSelectionChange={(keys) => {
                    const [key] = [...keys]
                    if (typeof key !== 'string') return
                    onChange(key === FOLLOW_VENDOR ? null : key)
                    setOpen(false)
                  }}
                  renderEmptyState={() => (
                    <p data-slot="provider-icon-empty" className="p-3 text-caption-1-regular text-text-secondary">
                      {t('settings.provider.iconNoMatch')}
                    </p>
                  )}
                  className="grid max-h-[40vh] grid-cols-3 gap-1 overflow-y-auto overscroll-contain @sm/pane:grid-cols-4"
                >
                  {[FOLLOW_VENDOR, ...visible].map((name) => (
                    <ListBox.Item
                      key={name}
                      id={name}
                      textValue={name === FOLLOW_VENDOR ? t('settings.provider.iconDefault') : name}
                      className="flex-col gap-1 px-2 py-2 text-center"
                    >
                      {name === FOLLOW_VENDOR ? (
                        <ProviderMark icon={null} catalogId={catalogId} providerType={providerType} size={20} />
                      ) : (
                        <ProviderMark icon={name} size={20} />
                      )}
                      <span data-slot="provider-icon-name" className="w-full truncate text-caption-2-regular">
                        {name === FOLLOW_VENDOR ? t('settings.provider.iconDefault') : name}
                      </span>
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Sheet.Body>
            </Sheet.Dialog>
          </Sheet.Content>
        </Sheet.Backdrop>
      </Sheet>
    </>
  )
}
