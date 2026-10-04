import { useState, type ReactNode, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Menu as AriaMenu,
  Popover as AriaPopover,
  SubmenuTrigger as AriaSubmenuTrigger,
  type Key,
} from 'react-aria-components'
import { Check, ChevronRight, Cpu, FaceSmile, Paperclip, Plus, Zap } from '@keyline-icons/react/two-tone'

import { Dropdown, DropdownItem, DropdownPopover, PromptInput, Tooltip, TooltipTrigger } from '@/components/base'
import { MENU_ITEMS_CONTAINER, MENU_POPOVER_SURFACE, MENU_POPOVER_WIDTH } from '@/components/base/dropdown/menu-styles'

import { cx } from '@/utils/cx'
import { currentValueName, knobName, knobValueName } from '@/lib/acp-knob-names'
import { titleIfTruncated } from '@/lib/truncation'
import type { AcpConfigOptionInfoResponse } from '@/types'

/**
 * What can be added to the message, behind one `+`: a file, a sticker, and —
 * in a hosted session — whatever of the agent's knobs is not the model, the
 * effort or the permission mode. Later, skills.
 *
 * Everything that used to share this menu has a place of its own now: the
 * permission mode is the chip beside it (`mode-chip.tsx`) and the model, the
 * effort, the assistant and fast mode are the panel at the toolbar's other end
 * (`model-panel.tsx`). A menu of everything about a turn was a menu nobody
 * could read at a glance; what is left is the one question `+` asks everywhere
 * else, "add what?".
 *
 * Built on the base `Dropdown` (React Aria's `Menu`); an agent knob is a value
 * row opening a submenu of its choices, `selectionMode="single"`, so the
 * current value is a checked `menuitemradio` — ArrowRight in, ArrowLeft out.
 * With nothing to offer there is no `+` at all.
 */

export interface ComposerMenuProps {
  onPickFile?: () => void
  /** Opens the sticker picker, which anchors itself to `triggerRef`. Absent hides the row. */
  onOpenStickers?: () => void
  /** The `+` itself, for what is drawn beside it once the menu has closed. */
  triggerRef?: Ref<HTMLButtonElement>
  /** A hosted agent's remaining knobs, each a row of its own. */
  knobs?: AcpConfigOptionInfoResponse[]
  onSetKnob?: (id: string, value: string) => void
  /** The agent is applying a change: its knob rows wait. */
  knobsBusy?: boolean
}

/** Icon, label and — for a value row — its current value at the end. */
function RowContent({
  icon: Icon,
  label,
  value,
  trailing,
}: {
  icon: typeof Cpu
  label: string
  value?: string
  trailing?: ReactNode
}) {
  return (
    <>
      <Icon aria-hidden className="size-4 shrink-0" />
      <span
        data-slot="composer-menu-item-label"
        onPointerEnter={titleIfTruncated}
        className="min-w-0 flex-1 truncate text-body-medium"
      >
        {label}
      </span>
      {value && (
        <span
          data-slot="composer-menu-item-value"
          onPointerEnter={titleIfTruncated}
          className="max-w-24 truncate text-caption-1-regular text-text-secondary"
        >
          {value}
        </span>
      )}
      {trailing}
    </>
  )
}

/** An agent knob: its row, and the submenu of its values. */
function KnobSubmenu({
  option,
  isDisabled,
  onSelect,
}: {
  option: AcpConfigOptionInfoResponse
  isDisabled?: boolean
  onSelect: (value: string) => void
}) {
  const { t } = useTranslation()
  const label = knobName(t, option)
  const value = currentValueName(t, option) ?? ''
  const selected = typeof option.currentValue === 'string' ? option.currentValue : null
  return (
    <AriaSubmenuTrigger>
      <DropdownItem id={`knob:${option.id}`} textValue={`${label}: ${value}`} isDisabled={isDisabled}>
        <RowContent
          icon={option.id === 'fast' ? Zap : Cpu}
          label={label}
          value={value}
          trailing={<ChevronRight aria-hidden className="size-4 shrink-0 text-text-secondary" />}
        />
      </DropdownItem>
      <AriaPopover offset={-4} className={cx(MENU_POPOVER_WIDTH, MENU_POPOVER_SURFACE, 'max-h-[min(20rem,60svh)]')}>
        <AriaMenu
          aria-label={label}
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={selected === null ? [] : [selected]}
          onAction={(key: Key) => {
            if (String(key) !== selected) onSelect(String(key))
          }}
          className={MENU_ITEMS_CONTAINER}
        >
          {option.options.map((choice) => (
            <DropdownItem key={choice.value} id={choice.value} textValue={knobValueName(t, option, choice)}>
              <span data-slot="composer-menu-detail-text" className="min-w-0 flex-1">
                <span className="block truncate text-body-medium">{knobValueName(t, option, choice)}</span>
                {choice.description && (
                  <span className="block truncate text-caption-1-regular text-text-secondary">
                    {choice.description}
                  </span>
                )}
              </span>
              {choice.value === selected && <Check aria-hidden className="size-4 shrink-0 text-text-secondary" />}
            </DropdownItem>
          ))}
        </AriaMenu>
      </AriaPopover>
    </AriaSubmenuTrigger>
  )
}

export function ComposerMenu({
  onPickFile,
  onOpenStickers,
  triggerRef,
  knobs = [],
  onSetKnob,
  knobsBusy,
}: ComposerMenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (!onPickFile && !onOpenStickers && knobs.length === 0) return null

  return (
    <Dropdown isOpen={open} onOpenChange={setOpen}>
      <TooltipTrigger delay={0}>
        {/* The composer's round control (the registry agent-composer's
            add button, `ai-chat-composer-add-*`). */}
        <PromptInput.Control
          ref={triggerRef}
          leadingIcon={Plus}
          aria-label={t('composer.menu')}
          data-slot="composer-menu-trigger"
          // The registry's "Add to chat" trigger (components.md, Dropdown
          // example) turns its plus into an × while the menu is open.
          className={cx('touch-hitbox [&_svg]:transition-transform [&_svg]:duration-200', open && '[&_svg]:rotate-45')}
        />
        <Tooltip placement="top">{t('composer.menu')}</Tooltip>
      </TooltipTrigger>

      <DropdownPopover aria-label={t('composer.menu')} placement="top start">
        {onPickFile ? (
          <DropdownItem id="attach" textValue={t('chat.attachFile')} onAction={onPickFile}>
            <RowContent icon={Paperclip} label={t('chat.attachFile')} />
          </DropdownItem>
        ) : null}
        {onOpenStickers ? (
          <DropdownItem id="stickers" textValue={t('chat.emoji')} onAction={onOpenStickers}>
            <RowContent icon={FaceSmile} label={t('chat.emoji')} />
          </DropdownItem>
        ) : null}
        {knobs.map((option) => (
          <KnobSubmenu
            key={option.id}
            option={option}
            isDisabled={knobsBusy}
            onSelect={(value) => onSetKnob?.(option.id, value)}
          />
        ))}
      </DropdownPopover>
    </Dropdown>
  )
}
