import './icon-picker.css'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Drawer } from '@/components/yuerchu-ui/components/drawer/drawer'
import { ListBox, ListBoxItem } from '@/components/yuerchu-ui/components/listbox/listbox'
import { SearchField } from '@/components/yuerchu-ui/components/search-field/search-field'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { ProviderMark } from '@/components/ui/provider-icon'
import { useHistoryLevel } from '@/hooks/use-history-level'

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
  ariaLabel,
}: {
  value: string | null
  catalogId: string | null
  providerType: string
  onChange: (icon: string | null) => void
  ariaLabel?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const names = useIconNames(open)
  const close = () => {
    setOpen(false)
    setFilter('')
  }
  // The library's Drawer does not know about the back gesture.
  useHistoryLevel(open, close)

  const visible = useMemo(() => {
    const query = filter.trim().toLowerCase()
    return query ? names.filter((name) => name.includes(query)) : names
  }, [names, filter])

  return (
    <>
      <Button
        data-slot="provider-icon-trigger"
        variant="secondary"
        aria-label={ariaLabel}
        onPress={() => setOpen(true)}
        className="m-icon-picker__trigger"
      >
        {/* Button puts its children in one label span, so the button's own
            gap never reaches between the mark and the name. */}
        <span data-slot="provider-icon-trigger-content" className="m-icon-picker__trigger-content">
          <ProviderMark icon={value} catalogId={catalogId} providerType={providerType} size={16} />
          <span data-slot="provider-icon-trigger-label" className="m-icon-picker__trigger-label">
            {value ?? t('settings.provider.iconDefault')}
          </span>
        </span>
      </Button>
      <Drawer
        isOpen={open}
        onOpenChange={(next) => (next ? setOpen(true) : close())}
        heading={t('settings.provider.iconChoose')}
        side="bottom"
        size="lg"
        className="m-icon-picker"
      >
        <SearchField
          aria-label={t('settings.provider.iconFilter')}
          name="providerIconFilter"
          autoComplete="off"
          value={filter}
          onChange={setFilter}
          placeholder={t('settings.provider.iconFilter')}
        />
        {/* The grid scrolls rather than the drawer: the filter box has to stay
            reachable while a hundred and fifty marks go past. */}
        <ListBox
          aria-label={t('settings.provider.iconChoose')}
          selectionMode="single"
          selectedKeys={[value ?? FOLLOW_VENDOR]}
          onSelectionChange={(keys) => {
            const [key] = [...keys]
            if (typeof key !== 'string') return
            onChange(key === FOLLOW_VENDOR ? null : key)
            setOpen(false)
          }}
          renderEmptyState={() => (
            <p data-slot="provider-icon-empty" className="m-icon-picker__empty">
              {t('settings.provider.iconNoMatch')}
            </p>
          )}
          className="m-icon-picker__grid"
        >
          {[FOLLOW_VENDOR, ...visible].map((name) => (
            <ListBoxItem
              key={name}
              id={name}
              textValue={name === FOLLOW_VENDOR ? t('settings.provider.iconDefault') : name}
              className="m-icon-picker__item"
            >
              {name === FOLLOW_VENDOR ? (
                <ProviderMark icon={null} catalogId={catalogId} providerType={providerType} size={20} />
              ) : (
                <ProviderMark icon={name} size={20} />
              )}
              <span data-slot="provider-icon-name" className="m-icon-picker__name">
                {name === FOLLOW_VENDOR ? t('settings.provider.iconDefault') : name}
              </span>
            </ListBoxItem>
          ))}
        </ListBox>
      </Drawer>
    </>
  )
}
