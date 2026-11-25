import { render, screen } from '@testing-library/react'
import { Button } from '@/components/yuerchu-ui/components/button/button'

it('does not observe static button labels for width animation', () => {
  const observe = vi.spyOn(ResizeObserver.prototype, 'observe')
  try {
    const { rerender } = render(<Button>Save</Button>)
    rerender(<Button>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    const observedLabels = observe.mock.calls.filter(
      ([element]) => element instanceof Element && element.classList.contains('ui-button__label'),
    )
    expect(button).toBeEnabled()
    expect(observedLabels).toHaveLength(0)
  } finally {
    observe.mockRestore()
  }
})
