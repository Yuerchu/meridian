import './font-picker.css'
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
import { Label } from '@/components/yuerchu-ui/components/field/field'
import { ChevronDown } from '@keyline-icons/react/two-tone'
import { isSafeFamilyName } from '@/lib/fonts'
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
      className="m-font-picker"
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
          <AriaGroup ref={groupRef} className="m-font-picker__group">
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
              className="m-font-picker__input"
            />
            <AriaButton
              aria-label={t('settings.general.fontShowList')}
              data-open={isOpen || undefined}
              className="m-font-picker__toggle"
            >
              <ChevronDown size={16} aria-hidden />
            </AriaButton>
          </AriaGroup>
          <AriaPopover ref={popoverRef} isNonModal offset={4} className="m-font-picker__popover">
            <AriaListBox data-slot="font-picker-list" className="m-font-picker__list">
              {(item: FontPickerItem) => (
                <AriaListBoxItem
                  id={item.id}
                  textValue={item.name}
                  className="m-font-picker__option"
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
