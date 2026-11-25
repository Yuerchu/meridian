import { Fragment } from 'react'
import { useTranslation } from 'react-i18next'
import { MoreVertical } from '@keyline-icons/react/two-tone'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from '@/components/yuerchu-ui/components/menu/menu'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'

import { ConversationTimeSection } from './conversation-time'
import type { RowAction } from './row-actions'

const GROUP_STARTS = new Set<RowAction['key']>(['export-sft', 'delete'])

/**
 * The dropdown's rows, shared between the button on a conversation row, the
 * project group header, and the right-click context menu.
 */
export function RowActionDropdownItems({ actions, grouped = false }: { actions: RowAction[]; grouped?: boolean }) {
  return (
    <>
      {actions.map((action, i) => (
        <Fragment key={action.key}>
          {grouped && i > 0 && GROUP_STARTS.has(action.key) && <MenuSeparator />}
          <MenuItem
            id={action.key}
            icon={<action.icon />}
            tone={action.variant === 'destructive' ? 'danger' : 'default'}
            isDisabled={Boolean(action.disabledReason)}
            // Part of the item's own text, not a tooltip: a disabled item takes
            // no pointer events, so a tooltip on one is unreachable by mouse and
            // by screen reader alike. The library reads it as the description.
            description={action.disabledReason}
            onAction={() => void action.run()}
          >
            {action.label}
          </MenuItem>
        </Fragment>
      ))}
    </>
  )
}

/**
 * The row actions button, anchored inside `NavItem`'s or `NavGroup`'s `actions`
 * slot so hover, keyboard focus, and touch all reveal it consistently.
 */
export function RowActionsMenu({
  label,
  updatedAt,
  actions,
}: {
  /** Names the button for a screen reader — the row's own title. */
  label: string
  /** When present (a conversation row), shows the full title and timestamp in the menu header. */
  updatedAt?: number
  /** This row's actions, already built. */
  actions: RowAction[]
}) {
  const { t } = useTranslation()
  const moreLabel = t('sidebar.moreActions', { name: label })
  return (
    <MenuTrigger>
      <TooltipTrigger>
        <Button
          variant="ghost"
          size="sm"
          icon={<MoreVertical />}
          aria-label={moreLabel}
          className="m-sidebar__icon-btn"
        />
        <Tooltip>{moreLabel}</Tooltip>
      </TooltipTrigger>
      <Menu placement="bottom end" aria-label={moreLabel}>
        {updatedAt !== undefined ? (
          <ConversationTimeSection title={label} updatedAt={updatedAt}>
            <RowActionDropdownItems actions={actions} grouped />
          </ConversationTimeSection>
        ) : (
          <RowActionDropdownItems actions={actions} grouped />
        )}
      </Menu>
    </MenuTrigger>
  )
}
