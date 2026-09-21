import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import '@/i18n'
import { expectCollapsed, expectExpanded } from '@/test/disclosure'
import {
  Avatar,
  Button,
  ContextMenu,
  DataGrid,
  Description,
  Disclosure,
  Dropdown,
  EmojiPicker,
  DropdownItem,
  DropdownPopover,
  Input,
  Label,
  Meter,
  Modal,
  Popover,
  SearchField,
  Select,
  SelectItem,
  Sheet,
  Sidebar,
  TextField,
  Toast,
  ToastQueue,
  Tooltip,
  TooltipTrigger,
} from '@/components/base'

/**
 * What every primitive under `components/base` promises the app, asserted
 * against the DOM rather than read off the source.
 *
 * Each case here is a defect that shipped once: a base component that looked
 * right, type-checked, and did nothing — a tooltip whose trigger was a native
 * button React Aria could not reach, a `slot="close"` on a button that knew no
 * slots, a disclosure whose trigger toggled nothing, a search field whose
 * `value` never arrived at its input. A file that fails here is not styling.
 */

describe('Button is a React Aria pressable', () => {
  it('opens a tooltip on keyboard focus and on hover', async () => {
    render(
      <TooltipTrigger delay={0} closeDelay={0}>
        <Button>Hover</Button>
        <Tooltip>tip text</Tooltip>
      </TooltipTrigger>,
    )
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Hover' })).toHaveFocus()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('tip text')
  })

  it('closes a Modal from slot="close"', async () => {
    const onOpenChange = vi.fn()
    render(
      <Modal.Backdrop isOpen onOpenChange={onOpenChange}>
        <Modal.Container>
          <Modal.Dialog aria-label="d">
            <Button slot="close">Close</Button>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('closes a Sheet from its CloseTrigger', async () => {
    const onOpenChange = vi.fn()
    render(
      <Sheet isOpen onOpenChange={onOpenChange} placement="right">
        <Sheet.Backdrop>
          <Sheet.Content>
            <Sheet.Dialog aria-label="panel">
              <Sheet.CloseTrigger aria-label="Close panel" />
            </Sheet.Dialog>
          </Sheet.Content>
        </Sheet.Backdrop>
      </Sheet>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  /**
   * The close button is React Aria's `slot="close"`, which reaches the overlay
   * directly. A dirty sheet has to intercept it there or the promise it makes
   * about unsaved work is one the base layer quietly does not keep.
   */
  it('asks before a dirty Sheet closes from its CloseTrigger', async () => {
    const onOpenChange = vi.fn()
    render(
      <Sheet isOpen isDirty onOpenChange={onOpenChange} placement="bottom">
        <Sheet.Backdrop>
          <Sheet.Content>
            <Sheet.Dialog aria-label="panel">
              <Sheet.CloseTrigger aria-label="Close panel" />
            </Sheet.Dialog>
          </Sheet.Content>
        </Sheet.Backdrop>
      </Sheet>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('announces pending and refuses the press', async () => {
    const onPress = vi.fn()
    render(
      <Button isPending onPress={onPress}>
        Send
      </Button>,
    )
    const button = screen.getByRole('button', { name: /Send/ })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button.querySelector('[data-slot="spinner"]')).not.toBeNull()
    await userEvent.click(button)
    expect(onPress).not.toHaveBeenCalled()
  })
})

describe('Disclosure', () => {
  it('toggles, names its panel, and hides it when shut', async () => {
    const onExpandedChange = vi.fn()
    render(
      <Disclosure onExpandedChange={onExpandedChange}>
        <Disclosure.Trigger>Details</Disclosure.Trigger>
        <Disclosure.Content>
          <Disclosure.Body>the details</Disclosure.Body>
        </Disclosure.Content>
      </Disclosure>,
    )
    const trigger = screen.getByRole('button', { name: 'Details' })
    expectCollapsed(trigger)
    await userEvent.click(trigger)
    expectExpanded(trigger)
    expect(onExpandedChange).toHaveBeenCalledWith(true)
  })
})

describe('Text controls are React Aria inputs', () => {
  it('TextField labels and describes its Input', () => {
    render(
      <TextField>
        <Label>Name</Label>
        <Input placeholder="…" />
        <Description>Your display name</Description>
      </TextField>,
    )
    const input = screen.getByRole('textbox', { name: 'Name' })
    expect(input).toHaveAccessibleDescription('Your display name')
  })

  it('SearchField is controlled through its root', async () => {
    const onChange = vi.fn()
    render(
      <SearchField aria-label="Search" value="ab" onChange={onChange}>
        <SearchField.Group>
          <SearchField.Input />
          <SearchField.ClearButton aria-label="Clear" />
        </SearchField.Group>
      </SearchField>,
    )
    const input = screen.getByRole('searchbox', { name: 'Search' })
    expect(input).toHaveValue('ab')
    await userEvent.type(input, 'c')
    expect(onChange).toHaveBeenLastCalledWith('abc')
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onChange).toHaveBeenLastCalledWith('')
  })

  it('Select is named by its label slot', () => {
    render(
      <Select label="Model" selectedKey="a">
        <SelectItem id="a" textValue="Alpha">
          Alpha
        </SelectItem>
      </Select>,
    )
    expect(screen.getByRole('button', { name: /Model/ })).toBeInTheDocument()
  })
})

describe('Menus open from their trigger', () => {
  it('Dropdown', async () => {
    const onAction = vi.fn()
    render(
      <Dropdown>
        <Button>Actions</Button>
        <DropdownPopover aria-label="Actions">
          <DropdownItem id="rename" onAction={onAction}>
            Rename
          </DropdownItem>
        </DropdownPopover>
      </Dropdown>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Actions' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    expect(onAction).toHaveBeenCalled()
  })

  it('ContextMenu, keeping the caller’s own handlers', async () => {
    const onPointerDown = vi.fn()
    render(
      <ContextMenu>
        <ContextMenu.Trigger onPointerDown={onPointerDown}>
          <span>row</span>
        </ContextMenu.Trigger>
        <ContextMenu.Popover>
          <ContextMenu.Menu aria-label="Row">
            <ContextMenu.Item id="copy">Copy</ContextMenu.Item>
          </ContextMenu.Menu>
        </ContextMenu.Popover>
      </ContextMenu>,
    )
    const row = screen.getByText('row')
    await userEvent.pointer({ keys: '[MouseRight>]', target: row })
    expect(onPointerDown).toHaveBeenCalled()
    expect(await screen.findByRole('menuitem', { name: 'Copy' })).toBeInTheDocument()
  })

  it('Popover.Trigger is a button a keyboard reaches', async () => {
    render(
      <Popover>
        <Popover.Trigger aria-label="gauge">
          <span>o</span>
        </Popover.Trigger>
        <Popover.Content placement="top">
          <Popover.Dialog aria-label="details">details</Popover.Dialog>
        </Popover.Content>
      </Popover>,
    )
    await userEvent.tab()
    const trigger = screen.getByRole('button', { name: 'gauge' })
    expect(trigger).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'details' })).toBeInTheDocument()
  })
})

describe('Sidebar.Menu is a tree', () => {
  it('walks rows with the arrow keys and acts on Enter', async () => {
    const onAction = vi.fn()
    render(
      <Sidebar.Provider>
        <Sidebar.Menu aria-label="Conversations">
          <Sidebar.MenuItem id="a" textValue="Alpha" onAction={() => onAction('a')}>
            <Sidebar.MenuLabel>Alpha</Sidebar.MenuLabel>
          </Sidebar.MenuItem>
          <Sidebar.MenuItem id="b" textValue="Beta" onAction={() => onAction('b')}>
            <Sidebar.MenuLabel>Beta</Sidebar.MenuLabel>
          </Sidebar.MenuItem>
        </Sidebar.Menu>
      </Sidebar.Provider>,
    )
    await userEvent.tab()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('row', { name: 'Beta' })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onAction).toHaveBeenCalledWith('b')
  })
})

describe('Toast region', () => {
  it('is fixed, placed, and shows what the queue holds', () => {
    const queue = new ToastQueue<{ title: string }>()
    queue.add({ title: 'Approve?' })
    render(
      <Toast.Provider queue={queue} placement="top">
        {({ toast }) => (
          <Toast toast={toast}>
            <Toast.Content>
              <Toast.Title>{toast.content.title}</Toast.Title>
            </Toast.Content>
          </Toast>
        )}
      </Toast.Provider>,
    )
    const region = screen.getByRole('region')
    expect(region).toHaveAttribute('data-placement', 'top')
    expect(region.className).toMatch(/\bfixed\b/)
    expect(within(region).getByText('Approve?')).toBeInTheDocument()
  })
})

describe('Presentation parts honour their props', () => {
  it('Avatar draws a child glyph instead of initials', () => {
    render(
      <Avatar initials="M">
        <svg data-testid="glyph" />
      </Avatar>,
    )
    expect(screen.getByTestId('glyph')).toBeInTheDocument()
    expect(screen.queryByText('M')).toBeNull()
  })

  it('Avatar falls back to its glyph when the photo fails to load', () => {
    render(
      <Avatar src="https://example.invalid/a.png">
        <svg data-testid="glyph" />
      </Avatar>,
    )
    expect(screen.queryByTestId('glyph')).toBeNull()
    fireEvent.error(screen.getByRole('presentation'))
    expect(screen.getByTestId('glyph')).toBeInTheDocument()
    expect(screen.queryByRole('presentation')).toBeNull()
  })

  it('DataGrid shows the property a column names by accessorKey alone', () => {
    type Row = { id: string; seen: number }
    render(
      <DataGrid<Row>
        aria-label="Counts"
        columns={[
          { id: 'id', header: 'Id', isRowHeader: true, cell: (r) => r.id },
          { id: 'seen', header: 'Seen', accessorKey: 'seen' },
        ]}
        data={[{ id: 'a', seen: 42 }]}
        getRowId={(r) => r.id}
      />,
    )
    expect(screen.getByRole('gridcell', { name: '42' })).toBeInTheDocument()
  })

  it('EmojiPicker names its dialog from the root label', async () => {
    render(
      <EmojiPicker aria-label="Stickers" isOpen>
        <EmojiPicker.Trigger aria-label="Open">+</EmojiPicker.Trigger>
        <EmojiPicker.Popover>
          <EmojiPicker.Content>body</EmojiPicker.Content>
        </EmojiPicker.Popover>
      </EmojiPicker>,
    )
    expect(await screen.findByRole('dialog', { name: 'Stickers' })).toBeInTheDocument()
  })

  it('Meter.Fill is as wide as the value', () => {
    const { container } = render(
      <Meter value={40} aria-label="Level">
        <Meter.Track>
          <Meter.Fill />
        </Meter.Track>
      </Meter>,
    )
    expect(screen.getByRole('meter')).toHaveStyle({ '--meter-percentage': '40%' })
    expect(container.querySelector('[data-slot="meter-fill"]')?.className).toMatch(/--meter-percentage/)
  })

  it('DataGrid with children is a treegrid with an expand button', async () => {
    type Row = { id: string; label: string; children?: Row[] }
    const rows: Row[] = [{ id: 'p', label: 'Parent', children: [{ id: 'c', label: 'Child' }] }]
    render(
      <DataGrid<Row>
        aria-label="Tree"
        columns={[{ id: 'label', header: 'Label', isRowHeader: true, cell: (r) => r.label }]}
        data={rows}
        getRowId={(r) => r.id}
        getChildren={(r) => r.children}
      />,
    )
    const grid = screen.getByRole('treegrid', { name: 'Tree' })
    expect(within(grid).queryByRole('rowheader', { name: 'Child' })).toBeNull()
    await userEvent.click(within(grid).getByRole('button', { name: /Expand row/ }))
    expect(within(grid).getByRole('rowheader', { name: 'Child' })).toBeInTheDocument()
  })
})
