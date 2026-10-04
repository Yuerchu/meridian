import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'
import type { Key } from 'react-aria-components'
import { ChevronsRight, Compass, Cpu, Hammer, ShieldCheck } from '@keyline-icons/react/two-tone'

import { Dropdown, DropdownGroup, DropdownItem, DropdownPopover, DropdownTrigger } from '@/components/base'
import { knobName, knobValueName } from '@/lib/acp-knob-names'
import { cx } from '@/utils/cx'
import type { AcpConfigOptionInfoResponse, ChatMode } from '@/types'

type Icon = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>
type Tone = 'default' | 'info' | 'warning'

interface ModeRow {
  id: string
  icon: Icon
  label: string
  description?: string
  tone: Tone
}

const TONE_ICON: Record<Tone, string> = {
  default: 'text-foreground-icon-secondary',
  info: 'text-status-info-soft-foreground',
  warning: 'text-status-warning-soft-foreground',
}

/**
 * How much the agent may do without asking, as a chip beside the `+`.
 *
 * It used to be a submenu and a checkbox inside the `+` menu, with a dot on
 * the `+` to say something there was not at its default — the fact that
 * approvals were being skipped was one menu deep. Now the current mode is
 * always on screen, and pressing it lists the modes with what each one does
 * (BoardUI Pro composer-panel's permission menu: icon, title, description, the
 * current row filled, closed on choosing).
 *
 * A ghost until hovered, pressed or open, with no chevron — the registry's
 * shape for a value that is read more often than it is changed.
 */
function ModeMenu({
  rows,
  selected,
  label,
  isDisabled,
  onSelect,
}: {
  rows: ModeRow[]
  selected: string | null
  label: string
  isDisabled?: boolean
  onSelect: (id: string) => void
}) {
  const { t } = useTranslation()
  const current = rows.find((row) => row.id === selected)
  const CurrentIcon = current?.icon ?? Cpu
  return (
    <Dropdown>
      <DropdownTrigger
        data-slot="mode-chip"
        aria-label={`${label}: ${current?.label ?? ''}`}
        isDisabled={isDisabled}
        className={cx(
          'inline-flex h-[30px] max-w-48 shrink-0 items-center gap-1 rounded-full ps-2 pe-2.5',
          'text-body-medium text-text-secondary transition-colors duration-150',
          'data-[hovered]:bg-background-primary-hover data-[pressed]:bg-background-primary-hover aria-expanded:bg-background-primary-hover',
          'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40',
        )}
      >
        <CurrentIcon aria-hidden className={cx('size-4 shrink-0', TONE_ICON[current?.tone ?? 'default'])} />
        {/* Dropped on a narrow composer: the icon and the accessible name stay. */}
        <span data-slot="mode-chip-label" className="truncate @max-[400px]/composer:hidden">
          {current?.label}
        </span>
      </DropdownTrigger>
      <DropdownPopover
        aria-label={label}
        placement="top start"
        className="w-[323px]"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={selected === null ? [] : [selected]}
        onAction={(key: Key) => onSelect(String(key))}
      >
        <DropdownGroup label={t('composer.permissions')}>
          {rows.map((row) => (
            <DropdownItem key={row.id} id={row.id} textValue={row.label} className="items-start gap-2.5">
              <row.icon aria-hidden className={cx('mt-0.5 size-5 shrink-0', TONE_ICON[row.tone])} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span data-slot="mode-row-label" className="truncate text-body-medium text-text-primary">
                  {row.label}
                </span>
                {row.description && (
                  <span
                    data-slot="mode-row-description"
                    title={row.description}
                    className="truncate text-body-2-regular text-text-secondary"
                  >
                    {row.description}
                  </span>
                )}
              </span>
            </DropdownItem>
          ))}
        </DropdownGroup>
      </DropdownPopover>
    </Dropdown>
  )
}

/**
 * This app's three modes, out of two settings.
 *
 * `mode` and `acceptEdits` are stored separately and stay that way, but only
 * three of their four combinations mean anything: plan mode removes every
 * editing tool, so "plan, and skip edit approvals" promises to skip approvals
 * that are never asked. Choosing a row writes only what has to change; a
 * refused write rolls back in `useTurnSettings`, and the chip follows what is
 * actually stored.
 *
 * The two writes are separate requests, so one can be refused after the other
 * was stored. They go in the order that makes that harmless: turning the
 * standing yes **on** waits for the mode to hold first, and turning it **off**
 * goes first, before the mode moves. Either way a half-finished change is never
 * more permissive than both the state it left and the one it was going to —
 * Plan → Accept edits refused at the mode does not leave edits pre-approved
 * for whenever the plan is approved.
 */
export function ModeChip({
  mode,
  acceptEdits,
  onSelectMode,
  onToggleAcceptEdits,
}: {
  mode: ChatMode
  acceptEdits: boolean
  /** Whether the change was stored, when the caller can say; no answer counts as yes. */
  onSelectMode: (mode: ChatMode) => void | Promise<boolean>
  onToggleAcceptEdits: (next: boolean) => void | Promise<boolean>
}) {
  const { t } = useTranslation()
  const rows: ModeRow[] = [
    {
      id: 'manual',
      icon: Hammer,
      label: t('composer.mode.manual'),
      description: t('composer.mode.manualDesc'),
      tone: 'default',
    },
    {
      id: 'auto',
      icon: ChevronsRight,
      label: t('composer.mode.autoAccept'),
      description: t('toolbar.acceptEdits.hint'),
      tone: 'warning',
    },
    { id: 'plan', icon: Compass, label: t('toolbar.mode.plan'), description: t('toolbar.mode.planDesc'), tone: 'info' },
  ]
  const selected = mode === 'plan' ? 'plan' : acceptEdits ? 'auto' : 'manual'
  const stored = (answer: void | boolean) => answer !== false
  const choose = async (id: string) => {
    const nextMode: ChatMode = id === 'plan' ? 'plan' : 'work'
    // Plan leaves the standing yes as it was; it has no edits to pre-approve.
    const nextAccept = id === 'plan' ? acceptEdits : id === 'auto'
    if (nextAccept && !acceptEdits) {
      if (nextMode !== mode && !stored(await onSelectMode(nextMode))) return
      await onToggleAcceptEdits(true)
      return
    }
    if (nextAccept !== acceptEdits && !stored(await onToggleAcceptEdits(nextAccept))) return
    if (nextMode !== mode) await onSelectMode(nextMode)
  }
  return <ModeMenu rows={rows} selected={selected} label={t('toolbar.mode')} onSelect={(id) => void choose(id)} />
}

/** The icon and tone for a value of a hosted agent's `mode` knob. */
function hostedRow(value: string): Pick<ModeRow, 'icon' | 'tone'> {
  switch (value.toLowerCase()) {
    case 'default':
      return { icon: Hammer, tone: 'default' }
    case 'acceptedits':
      return { icon: ChevronsRight, tone: 'warning' }
    case 'plan':
      return { icon: Compass, tone: 'info' }
    case 'bypasspermissions':
      return { icon: ShieldCheck, tone: 'warning' }
    default:
      return { icon: Cpu, tone: 'default' }
  }
}

/**
 * A hosted agent's permission mode: its own values, under its own names where
 * there is no translation, set over ACP. Which modes exist is the agent's
 * answer, not this app's.
 */
export function HostedModeChip({
  option,
  busy,
  onSelect,
}: {
  option: AcpConfigOptionInfoResponse
  busy?: boolean
  onSelect: (value: string) => void
}) {
  const { t } = useTranslation()
  const rows: ModeRow[] = option.options.map((value) => ({
    id: value.value,
    label: knobValueName(t, option, value),
    description: value.description ?? undefined,
    ...hostedRow(value.value),
  }))
  const selected = typeof option.currentValue === 'string' ? option.currentValue : null
  return (
    <ModeMenu
      rows={rows}
      selected={selected}
      label={knobName(t, option)}
      isDisabled={busy}
      onSelect={(value) => {
        if (value !== selected) onSelect(value)
      }}
    />
  )
}
