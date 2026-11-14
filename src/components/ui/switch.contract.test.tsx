import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Switch } from '@/components/yuerchu-ui/components/switch/switch'

it('keeps a controlled switch named and keyboard-operable', async () => {
  const user = userEvent.setup()
  const change = vi.fn()
  function Harness() {
    const [selected, setSelected] = useState(false)
    return (
      <>
        <span id="setting-label">Remote access</span>
        <p id="setting-description">Only on the local network</p>
        <Switch
          aria-labelledby="setting-label"
          aria-describedby="setting-description"
          isSelected={selected}
          onChange={(next) => {
            setSelected(next)
            change(next)
          }}
        />
      </>
    )
  }
  render(<Harness />)
  const control = screen.getByRole('switch', { name: 'Remote access' })
  expect(control).toHaveAccessibleDescription('Only on the local network')
  expect(control).not.toBeChecked()
  await user.tab()
  expect(control).toHaveFocus()
  await user.keyboard(' ')
  expect(control).toBeChecked()
  expect(change).toHaveBeenCalledExactlyOnceWith(true)
})

it('toggles from a card label without including its description in the name', async () => {
  const user = userEvent.setup()
  const change = vi.fn()
  render(
    <Switch variant="card" description="Only on the local network" onChange={change}>
      Remote access
    </Switch>,
  )
  const control = screen.getByRole('switch', { name: 'Remote access' })
  expect(control).toHaveAccessibleDescription('Only on the local network')
  await user.click(screen.getByText('Remote access'))
  expect(control).toBeChecked()
  expect(change).toHaveBeenCalledExactlyOnceWith(true)
})

it('does not change a disabled switch', async () => {
  const user = userEvent.setup()
  const change = vi.fn()
  render(
    <Switch isDisabled isSelected onChange={change}>
      Unavailable
    </Switch>,
  )
  const control = screen.getByRole('switch', { name: 'Unavailable' })
  await user.click(control)
  expect(control).toBeChecked()
  expect(control).toBeDisabled()
  expect(change).not.toHaveBeenCalled()
})
