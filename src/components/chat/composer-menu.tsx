import './composer-menu.css'
import { useState, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { type Key } from 'react-aria-components'
import { Cpu, FaceSmile, Paperclip, Plus, Zap } from '@keyline-icons/react/two-tone'

import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Menu, MenuItem, MenuTrigger, SubmenuTrigger } from '@/components/yuerchu-ui/components/menu/menu'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'

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
 * Built on Yuerchu UI `MenuTrigger` / `Menu` / `MenuItem` / `SubmenuTrigger`;
 * an agent knob is a value row opening a submenu of its choices,
 * `selectionMode="single"`, so the current value is a checked `menuitemradio`
 * — ArrowRight in, ArrowLeft out. With nothing to offer there is no `+` at all.
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
  const Icon = option.id === 'fast' ? Zap : Cpu

  return (
    <SubmenuTrigger>
      <MenuItem
        id={`knob:${option.id}`}
        textValue={`${label}: ${value}`}
        isDisabled={isDisabled}
        icon={<Icon aria-hidden />}
        trailing={
          value ? (
            <span
              data-slot="composer-menu-item-value"
              onPointerEnter={titleIfTruncated}
              className="m-composer-menu__item-value"
            >
              {value}
            </span>
          ) : undefined
        }
      >
        <span
          data-slot="composer-menu-item-label"
          onPointerEnter={titleIfTruncated}
          className="m-composer-menu__item-label"
        >
          {label}
        </span>
      </MenuItem>
      <Menu
        aria-label={label}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={selected === null ? [] : [selected]}
        onAction={(key: Key) => {
          if (String(key) !== selected) onSelect(String(key))
        }}
        className="m-composer-menu__submenu"
      >
        {option.options.map((choice) => (
          <MenuItem
            key={choice.value}
            id={choice.value}
            textValue={knobValueName(t, option, choice)}
            description={choice.description ?? undefined}
          >
            <span data-slot="composer-menu-detail-text" className="m-composer-menu__detail-label">
              {knobValueName(t, option, choice)}
            </span>
          </MenuItem>
        ))}
      </Menu>
    </SubmenuTrigger>
  )
}

/** Toolbar `+` menu for attachments, stickers, and extra hosted-agent knobs. */
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
    <span className="m-composer-menu" data-open={open || undefined}>
      <MenuTrigger isOpen={open} onOpenChange={setOpen}>
        <TooltipTrigger>
          <Button
            ref={triggerRef}
            variant="secondary"
            size="md"
            icon={<Plus />}
            aria-label={t('composer.menu')}
            data-slot="composer-menu-trigger"
          />
          <Tooltip placement="top">{t('composer.menu')}</Tooltip>
        </TooltipTrigger>

        <Menu aria-label={t('composer.menu')} placement="top start" className="m-composer-menu__menu">
          {onPickFile ? (
            <MenuItem
              id="attach"
              icon={<Paperclip aria-hidden />}
              textValue={t('chat.attachFile')}
              onAction={onPickFile}
            >
              <span
                data-slot="composer-menu-item-label"
                onPointerEnter={titleIfTruncated}
                className="m-composer-menu__item-label"
              >
                {t('chat.attachFile')}
              </span>
            </MenuItem>
          ) : null}
          {onOpenStickers ? (
            <MenuItem
              id="stickers"
              icon={<FaceSmile aria-hidden />}
              textValue={t('chat.emoji')}
              onAction={onOpenStickers}
            >
              <span
                data-slot="composer-menu-item-label"
                onPointerEnter={titleIfTruncated}
                className="m-composer-menu__item-label"
              >
                {t('chat.emoji')}
              </span>
            </MenuItem>
          ) : null}
          {knobs.map((option) => (
            <KnobSubmenu
              key={option.id}
              option={option}
              isDisabled={knobsBusy}
              onSelect={(value) => onSetKnob?.(option.id, value)}
            />
          ))}
        </Menu>
      </MenuTrigger>
    </span>
  )
}
