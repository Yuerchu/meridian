import { useContext, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Button as AriaButton,
  ComboBox as AriaComboBox,
  ComboBoxStateContext,
  Group as AriaGroup,
  Input as AriaInput,
  ListBox as AriaListBox,
  ListBoxItem as AriaListBoxItem,
  Popover as AriaPopover,
  type Key,
} from 'react-aria-components'
import { Label } from '@/components/base'
import {
  MENU_ITEM,
  MENU_ITEM_ACTIVE,
  MENU_ITEMS_CONTAINER,
  MENU_POPOVER_SURFACE,
} from '@/components/base/dropdown/menu-styles'
import { ChevronDownSmall } from '@/components/foundations/icons/chevrons'
import { isSafeFamilyName } from '@/lib/fonts'
import { cx } from '@/utils/cx'
import { useDismissOnOutsidePress } from '@/utils/use-dismiss-on-outside-press'

/** List key for "use the CSS default stack". Never written to localStorage. */
export const SYSTEM_KEY = '__meridian_system__'

type FontPickerItem = {
  id: string
  name: string
}

/** ComboBox is `isNonModal`, which turns off RAC's outside-press dismiss. */
function FontPickerDismiss({
  groupRef,
  popoverRef,
}: {
  groupRef: RefObject<HTMLDivElement | null>
  popoverRef: RefObject<HTMLElement | null>
}) {
  const state = useContext(ComboBoxStateContext)
  useDismissOnOutsidePress(state?.isOpen === true, () => state?.close(), [groupRef, popoverRef])
  return null
}

export function FontPicker({
  label,
  value,
  onChange,
  families,
}: {
  label: string
  value: string | null
  onChange: (family: string | null) => void
  families: string[]
}) {
  const { t } = useTranslation()
  const [inputValue, setInputValue] = useState(value ?? '')
  const isOpenRef = useRef(false)
  const groupRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLElement>(null)

  useEffect(() => {
    setInputValue(value ?? '')
  }, [value])

  const items = useMemo<FontPickerItem[]>(() => {
    const seen = new Set(families.map((family) => family.toLowerCase()))
    const extra = value !== null && !seen.has(value.toLowerCase()) ? [value] : []
    return [
      { id: SYSTEM_KEY, name: t('settings.general.fontSystem') },
      ...[...extra, ...families].map((name) => ({ id: name, name })),
    ]
  }, [families, value, t])

  // Keep `selectedKey` in step with the visible text. A committed family whose
  // key stays selected while the input is a filter string makes RAC reset the
  // input to that family's name, which is what made typing impossible.
  const selectedKey =
    value !== null && inputValue === value ? value : value === null && inputValue === '' ? SYSTEM_KEY : null

  const commit = (next: string | null) => {
    if (next === null) {
      onChange(null)
      setInputValue('')
      return
    }
    if (!isSafeFamilyName(next)) {
      setInputValue(value ?? '')
      return
    }
    onChange(next)
    setInputValue(next)
  }

  const commitTyped = () => {
    const trimmed = inputValue.trim()
    if (trimmed === '') {
      commit(null)
      return
    }
    if (value !== null && trimmed === value) return
    commit(trimmed)
  }

  const handleSelectionChange = (key: Key | null) => {
    if (key === null) return
    if (key === SYSTEM_KEY) {
      commit(null)
      return
    }
    commit(String(key))
  }

  return (
    <AriaComboBox<FontPickerItem>
      data-slot="font-picker"
      className="flex w-full max-w-xs flex-col gap-1"
      items={items}
      selectedKey={selectedKey}
      onSelectionChange={handleSelectionChange}
      inputValue={inputValue}
      onInputChange={setInputValue}
      allowsCustomValue
      menuTrigger="focus"
      defaultFilter={(textValue, input) => {
        // A committed name in the field is the selection, not a filter: opening
        // the list has to show every family, including System.
        if (input === '' || (value !== null && input === value)) return true
        return textValue.toLowerCase().includes(input.toLowerCase())
      }}
      onOpenChange={(open) => {
        isOpenRef.current = open
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        if (isOpenRef.current) return
        event.preventDefault()
        commitTyped()
      }}
    >
      {({ isOpen }) => (
        <>
          <FontPickerDismiss groupRef={groupRef} popoverRef={popoverRef} />
          <Label>{label}</Label>
          <AriaGroup
            ref={groupRef}
            className={cx(
              'flex w-full items-center justify-between rounded-2lg',
              'border border-border-button-default bg-background-primary-default shadow-xs',
              'text-text-primary',
              'transition-[background-color,border-color,box-shadow] duration-200 ease',
              'data-[hovered]:border-border-button-hover data-[hovered]:bg-background-primary-hover',
              'focus-within:ring-2 focus-within:ring-border-focus-ring focus-within:ring-offset-2',
              'gap-1.5 px-2.5 py-2',
            )}
          >
            <AriaInput
              autoComplete="off"
              spellCheck={false}
              placeholder={t('settings.general.fontSystem')}
              onFocus={(event) => event.currentTarget.select()}
              onBlur={(event) => {
                const next = event.relatedTarget
                if (next instanceof Node && (groupRef.current?.contains(next) || popoverRef.current?.contains(next))) {
                  return
                }
                commitTyped()
              }}
              className="min-w-0 flex-1 bg-transparent text-body-medium text-text-primary outline-none placeholder:text-text-secondary"
            />
            <AriaButton
              aria-label={t('settings.general.fontShowList')}
              className="shrink-0 text-text-secondary outline-none"
            >
              <ChevronDownSmall
                className={cx('size-4 transition-transform duration-200 ease', isOpen && 'rotate-180')}
              />
            </AriaButton>
          </AriaGroup>
          <AriaPopover
            ref={popoverRef}
            isNonModal
            offset={4}
            className={cx('min-w-[var(--trigger-width)]', MENU_POPOVER_SURFACE, 'p-2')}
          >
            <AriaListBox
              data-slot="font-picker-list"
              className={cx(MENU_ITEMS_CONTAINER, 'max-h-[240px] overflow-auto')}
            >
              {(item: FontPickerItem) => (
                <AriaListBoxItem
                  id={item.id}
                  textValue={item.name}
                  className={(state) =>
                    cx(
                      MENU_ITEM,
                      'truncate text-body-medium',
                      (state.isFocused || state.isSelected) && MENU_ITEM_ACTIVE,
                    )
                  }
                  style={item.id === SYSTEM_KEY ? undefined : { fontFamily: `"${item.id}"` }}
                >
                  {item.name}
                </AriaListBoxItem>
              )}
            </AriaListBox>
          </AriaPopover>
        </>
      )}
    </AriaComboBox>
  )
}
