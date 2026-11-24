import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SettingsDrilldown } from './settings-drilldown'

const mobile = vi.hoisted(() => ({ value: true }))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => mobile.value }))

describe('SettingsDrilldown', () => {
  it('is a section with its content in place on a wide viewport', () => {
    mobile.value = false
    render(
      <SettingsDrilldown title="Tools">
        <p>tool list</p>
      </SettingsDrilldown>,
    )
    expect(screen.getByRole('heading', { name: 'Tools' })).toBeInTheDocument()
    expect(screen.getByText('tool list')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('is a row that opens a full-window dialog on a phone, and closes again', async () => {
    mobile.value = true
    const user = userEvent.setup()
    render(
      <SettingsDrilldown title="Tools" summary="All">
        <p>tool list</p>
      </SettingsDrilldown>,
    )
    expect(screen.queryByText('tool list')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Tools' }))
    const dialog = await screen.findByRole('dialog', { name: 'Tools' })
    expect(dialog).toHaveTextContent('tool list')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
