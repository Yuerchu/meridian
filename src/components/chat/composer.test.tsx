import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@/i18n'
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

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

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

describe('Composer as a combobox', () => {
  it('puts the caller combobox attributes on the textarea', () => {
    render(
      <Composer
        value="/mo"
        onChange={() => {}}
        onSubmit={() => {}}
        ariaLabel="Message"
        fieldProps={{
          role: 'combobox',
          'aria-autocomplete': 'list',
          'aria-expanded': true,
          'aria-controls': 'list-1',
          'aria-activedescendant': 'list-1-option-0',
        }}
      />,
    )
    const field = screen.getByRole('combobox', { name: 'Message' })
    expect(field.tagName).toBe('TEXTAREA')
    expect(field).toHaveAttribute('aria-expanded', 'true')
    expect(field).toHaveAttribute('aria-controls', 'list-1')
    expect(field).toHaveAttribute('aria-activedescendant', 'list-1-option-0')
    expect(field).toHaveAttribute('aria-autocomplete', 'list')
  })
})

describe('Composer while a steerable run streams', () => {
  function renderRun(value: string, handlers: { onSubmit?: () => void; onStop?: () => void } = {}) {
    return render(
      <Composer
        value={value}
        onChange={() => {}}
        onSubmit={handlers.onSubmit ?? (() => {})}
        onStop={handlers.onStop ?? (() => {})}
        streaming
        steerable
        ariaLabel="Message"
      />,
    )
  }

  it('sends what was typed, and offers exactly one Stop beside it', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    const onStop = vi.fn()
    renderRun('turn left', { onSubmit, onStop })

    expect(screen.getAllByRole('button', { name: i18n.t('chat.stop') })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: i18n.t('chat.send') }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onStop).not.toHaveBeenCalled()
  })

  it('is a single Stop when there is nothing to steer with', async () => {
    const user = userEvent.setup()
    const onStop = vi.fn()
    renderRun('', { onStop })

    const stops = screen.getAllByRole('button', { name: i18n.t('chat.stop') })
    expect(stops).toHaveLength(1)
    expect(screen.queryByRole('button', { name: i18n.t('chat.send') })).toBeNull()
    await user.click(stops[0])
    expect(onStop).toHaveBeenCalledTimes(1)
  })
})
