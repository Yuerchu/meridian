import { render, screen, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import i18n from '@/i18n'
import { isSettingsTabDirty } from './dirty-guard'
import { SettingsStack, useSettingsDraft, useSettingsLevel, useSettingsStack } from './settings-stack'

/**
 * The stack is four mechanisms wearing one API: pages, history levels, a leave
 * guard scoped per page, and scroll and focus that follow the navigation. Each
 * of them has a way of being subtly wrong that looks like nothing at all —
 * a back gesture that leaves the app, a question about a draft nobody is
 * discarding, focus left on a row that is no longer on screen.
 */
type Level = { kind: 'detail'; id: string } | { kind: 'sub'; id: string }

function Page({ title, dirty, children }: { title: string; dirty?: boolean; children?: React.ReactNode }) {
  const { index, pop } = useSettingsLevel()
  useSettingsDraft('provider', `page-${index}`, dirty ?? false)
  return (
    <div>
      {index > 0 && (
        <button data-slot="settings-page-back" onClick={() => void pop()}>
          {i18n.t('common.back')}
        </button>
      )}
      <h2>{title}</h2>
      {children}
    </div>
  )
}

function Harness({
  rootDirty,
  detailDirty,
  subDirty,
  stackRef,
}: {
  rootDirty?: boolean
  detailDirty?: boolean
  subDirty?: boolean
  stackRef?: { current: ReturnType<typeof useSettingsStack<Level>> | null }
}) {
  const stack = useSettingsStack<Level>()
  if (stackRef) stackRef.current = stack
  return (
    <div data-slot="settings-scroller">
      <SettingsStack stack={stack}>
        {(level) =>
          level === null ? (
            <Page title="List" dirty={rootDirty}>
              <button data-key="row-1" onClick={() => stack.push({ kind: 'detail', id: 'one' })}>
                open one
              </button>
              <button data-key="row-2" onClick={() => stack.push({ kind: 'detail', id: 'two' })}>
                open two
              </button>
            </Page>
          ) : level.kind === 'detail' ? (
            <Page title={`Detail ${level.id}`} dirty={detailDirty}>
              <button onClick={() => stack.push({ kind: 'sub', id: level.id })}>open sub</button>
            </Page>
          ) : (
            <Page title={`Sub ${level.id}`} dirty={subDirty} />
          )
        }
      </SettingsStack>
    </div>
  )
}

const visible = () => document.querySelector<HTMLElement>('[data-slot="settings-level"]:not([hidden])')
const click = (name: string) => userEvent.click(screen.getByRole('button', { name }))

describe('SettingsStack', () => {
  it('shows one page at a time and keeps the rest mounted', async () => {
    render(<Harness />)
    expect(visible()?.dataset.index).toBe('0')
    expect(screen.queryByRole('button', { name: i18n.t('common.back') })).not.toBeInTheDocument()

    await click('open one')
    expect(visible()?.dataset.index).toBe('1')
    expect(screen.getByRole('heading', { name: 'Detail one' })).toBeInTheDocument()
    // Still in the DOM, so its draft and its dirty registration survive — and
    // out of the accessibility tree, which is what `hidden` buys: a screen
    // reader is on one page too.
    const list = screen.getByRole('heading', { name: 'List', hidden: true })
    expect(list.closest('[data-slot="settings-level"]')).toHaveAttribute('hidden')
    expect(screen.queryByRole('heading', { name: 'List' })).not.toBeInTheDocument()

    await click(i18n.t('common.back'))
    expect(visible()?.dataset.index).toBe('0')
  })

  /**
   * The guard is about what is being discarded, not about what is dirty.
   * Popping a clean sub-page onto a dirty parent discards nothing: the parent
   * is still mounted and still holding its draft.
   */
  it('asks only about the pages it is discarding', async () => {
    render(<Harness detailDirty />)
    await click('open one')
    await click('open sub')

    // Sub is clean, so going back to a dirty Detail asks nothing.
    await click(i18n.t('common.back'))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(visible()?.dataset.index).toBe('1')

    // Leaving Detail itself does ask.
    await click(i18n.t('common.back'))
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    await click(i18n.t('common.cancel'))
    expect(visible()?.dataset.index).toBe('1')

    await click(i18n.t('common.back'))
    await click(i18n.t('common.confirm'))
    expect(visible()?.dataset.index).toBe('0')
  })

  it('opens a page over a dirty one without asking', async () => {
    render(<Harness detailDirty />)
    await click('open one')
    await click('open sub')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(visible()?.dataset.index).toBe('2')
  })

  it('unwinds without asking after a delete', async () => {
    const stackRef = { current: null as ReturnType<typeof useSettingsStack<Level>> | null }
    render(<Harness detailDirty stackRef={stackRef} />)
    await click('open one')
    await act(async () => {
      stackRef.current!.reset()
    })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(visible()?.dataset.index).toBe('0')
  })

  it('registers a page draft with the tab, and clears it on the way back', async () => {
    render(<Harness detailDirty />)
    await click('open one')
    expect(isSettingsTabDirty('provider')).toBe(true)

    await click(i18n.t('common.back'))
    await click(i18n.t('common.confirm'))
    expect(isSettingsTabDirty('provider')).toBe(false)
  })

  describe('Escape', () => {
    it('goes back one page, and does nothing at the root', async () => {
      render(<Harness />)
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(visible()?.dataset.index).toBe('0')

      await click('open one')
      await act(async () => {
        fireEvent.keyDown(window, { key: 'Escape' })
      })
      expect(visible()?.dataset.index).toBe('0')
    })

    /** A press meant for an open question must not also pop the page behind it. */
    it('is left to whichever dialog is open', async () => {
      render(<Harness detailDirty />)
      await click('open one')
      await click(i18n.t('common.back'))
      const dialog = screen.getByRole('alertdialog')

      await act(async () => {
        fireEvent.keyDown(dialog, { key: 'Escape' })
      })
      expect(visible()?.dataset.index).toBe('1')
    })

    /**
     * And the same when the dialog does *not* answer the key.
     *
     * React Aria's dismissable overlays call `preventDefault`, which the hotkey
     * hook already declines to act on. One that has its keyboard dismissal
     * disabled leaves the event untouched, and then the only thing standing
     * between the reader and a page popping out from under an unanswered
     * question is where the press landed.
     */
    it('is left to a dialog that does not consume the key either', async () => {
      render(
        <>
          <Harness />
          <div role="alertdialog" aria-label="silent">
            <button>inside</button>
          </div>
        </>,
      )
      await click('open one')
      await act(async () => {
        fireEvent.keyDown(screen.getByRole('button', { name: 'inside' }), { key: 'Escape' })
      })
      expect(visible()?.dataset.index).toBe('1')
    })
  })

  describe('focus', () => {
    it('moves to the new page and returns to the row that opened it', async () => {
      render(<Harness />)
      const row = screen.getByRole('button', { name: 'open two' })
      row.focus()
      await click('open two')
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      })
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Detail two' }))

      await click(i18n.t('common.back'))
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      })
      expect(document.activeElement).toBe(row)
    })
  })
})
