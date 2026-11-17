import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Checkbox, CheckboxGroup } from '@/components/yuerchu-ui/components/checkbox/checkbox'
import { DataGrid } from './data-grid'
import '@/i18n'

function Choices() {
  const [value, setValue] = useState(['read'])
  return (
    <CheckboxGroup label="Tools" description="Choose workspace access" value={value} onChange={setValue}>
      <Checkbox value="read" variant="card" description="Read workspace files">
        Read
      </Checkbox>
      <Checkbox value="write">Write</Checkbox>
      <Checkbox value="run" isDisabled>
        Run
      </Checkbox>
    </CheckboxGroup>
  )
}

describe('migrated checkbox interaction contracts', () => {
  it('keeps group naming, descriptions, label clicks and keyboard multi-selection', async () => {
    const user = userEvent.setup()
    render(<Choices />)
    const group = screen.getByRole('group', { name: 'Tools' })
    expect(group).toHaveAccessibleDescription('Choose workspace access')
    const read = within(group).getByRole('checkbox', { name: 'Read', exact: true })
    const write = within(group).getByRole('checkbox', { name: 'Write' })
    expect(read).toHaveAccessibleDescription('Read workspace files Choose workspace access')
    expect(read).toBeChecked()
    await user.tab()
    expect(read).toHaveFocus()
    await user.keyboard(' ')
    expect(read).not.toBeChecked()
    await user.tab()
    expect(write).toHaveFocus()
    await user.keyboard(' ')
    expect(write).toBeChecked()
    await user.click(screen.getByText('Read', { exact: true }))
    expect(read).toBeChecked()
    expect(write).toBeChecked()
    expect(within(group).getByRole('checkbox', { name: 'Run' })).toBeDisabled()
  })

  it('retains mixed state and prevents read-only changes', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Checkbox isIndeterminate aria-label="Some selected" />
        <Checkbox isReadOnly defaultSelected>
          Locked
        </Checkbox>
      </>,
    )
    expect(screen.getByRole('checkbox', { name: 'Some selected' })).toBePartiallyChecked()
    await user.click(screen.getByRole('checkbox', { name: 'Locked' }))
    expect(screen.getByRole('checkbox', { name: 'Locked' })).toBeChecked()
  })

  it('receives table selection slot labels, mixed state and select-all behavior', async () => {
    const user = userEvent.setup()
    render(
      <DataGrid
        aria-label="Files"
        columns={[{ key: 'name', header: 'Name', isRowHeader: true, cell: (item) => item.name }]}
        items={[
          { id: 'a', name: 'Alpha' },
          { id: 'b', name: 'Beta' },
        ]}
        getKey={(item) => item.id}
        selectionMode="multiple"
        showSelectionCheckboxes
      />,
    )
    const [all, alpha, beta] = screen.getAllByRole('checkbox')
    expect(all).toHaveAccessibleName()
    expect(alpha).toHaveAccessibleName()
    expect(beta).toHaveAccessibleName()
    await user.click(alpha)
    expect(alpha).toBeChecked()
    expect(beta).not.toBeChecked()
    expect(all).toBePartiallyChecked()
    await user.click(all)
    expect(alpha).toBeChecked()
    expect(beta).toBeChecked()
    await user.click(all)
    expect(alpha).not.toBeChecked()
    expect(beta).not.toBeChecked()
  })
})
