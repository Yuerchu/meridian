import { render } from '@testing-library/react'
import { Composer } from './composer'

/**
 * The composer's run state, as the registry's agent-composer draws it: while a
 * turn runs the send button is the grey stop (not the primary pill) and
 * composer-loader's light is up behind a shell that has stepped aside.
 */
function renderComposer(streaming: boolean) {
  return render(
    <Composer
      value=""
      onChange={() => {}}
      onSubmit={() => {}}
      onStop={() => {}}
      streaming={streaming}
      ariaLabel="Message"
    />,
  )
}

describe('Composer run state', () => {
  it('draws Stop as the grey round button and lights the loader while a turn runs', () => {
    const { container } = renderComposer(true)
    const send = container.querySelector<HTMLElement>('[data-slot="prompt-input-send"]')!
    expect(send.className).toContain('bg-background-secondary-default')
    expect(send.className).not.toContain('bg-button-primary')
    expect(send.className).toContain('rounded-full')

    const shell = container.querySelector<HTMLElement>('[data-slot="prompt-input-shell"]')!
    expect(shell.className).toContain('bg-transparent')
    // composer-loader's light layer: the clip span whose opacity it fades.
    const light = [...container.querySelectorAll<HTMLElement>('span[aria-hidden]')].find((s) => s.querySelector('svg'))!
    expect(light.style.opacity).toBe('1')
  })

  it('is the primary send and an unlit loader when idle', () => {
    const { container } = renderComposer(false)
    const send = container.querySelector<HTMLElement>('[data-slot="prompt-input-send"]')!
    expect(send.className).toContain('bg-button-primary')
    const light = [...container.querySelectorAll<HTMLElement>('span[aria-hidden]')].find((s) => s.querySelector('svg'))!
    expect(light.style.opacity).toBe('0')
  })
})
