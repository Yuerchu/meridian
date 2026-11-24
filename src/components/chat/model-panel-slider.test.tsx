import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Slider } from '@/components/yuerchu-ui/components/slider/slider'

it('names a single slider from its root without repeating the name', () => {
  render(<Slider aria-label="Effort" defaultValue={1} maxValue={3} showValue={false} />)
  expect(screen.getByRole('group', { name: 'Effort' })).toContainElement(screen.getByRole('slider', { name: 'Effort' }))
})

it('preserves range thumb names, keyboard commit boundaries and disabled state', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn()
  const onChangeEnd = vi.fn()
  const { rerender } = render(
    <Slider
      label="Range"
      thumbLabels={['Minimum', 'Maximum']}
      defaultValue={[20, 80]}
      onChange={onChange}
      onChangeEnd={onChangeEnd}
      showValue="thumb"
    />,
  )
  const group = screen.getByRole('group', { name: 'Range' })
  const minimum = within(group).getByRole('slider', { name: 'Minimum Range' })
  expect(within(group).getByRole('slider', { name: 'Maximum Range' })).toHaveValue('80')
  await user.tab()
  expect(minimum).toHaveFocus()
  await user.keyboard('{ArrowRight}')
  expect(onChange).toHaveBeenLastCalledWith([21, 80])
  expect(onChangeEnd).toHaveBeenLastCalledWith([21, 80])
  rerender(<Slider label="Range" thumbLabels={['Minimum', 'Maximum']} value={[20, 80]} isDisabled />)
  for (const slider of screen.getAllByRole('slider')) expect(slider).toBeDisabled()
})
