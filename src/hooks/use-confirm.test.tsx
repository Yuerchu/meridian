import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import i18n from '@/i18n'
import { useHistoryStore } from '@/stores/history-store'
import { attachHistory } from '@/lib/history-bridge'
import { resizeViewportTo } from '@/test/viewport'
import { useConfirm } from './use-confirm'

/**
 * The promise is the whole point of this hook, and a promise that never settles
 * is invisible: the caller simply does not resume, so the row is not deleted and
 * nothing at all is reported. These pin the three ways it has to settle.
 */
type Ask = (body?: string) => Promise<boolean>

function Harness({ onAnswer, askRef }: { onAnswer: (ok: boolean) => void; askRef?: { current: Ask | null } }) {
  const { confirm, confirmDialog } = useConfirm()
  const ask: Ask = (body = 'Sure?') => confirm({ body })
  if (askRef) askRef.current = ask
  return (
    <>
      <button onClick={async () => onAnswer(await ask())}>ask</button>
      {confirmDialog}
    </>
  )
}

const click = (name: string) => userEvent.click(screen.getByRole('button', { name }))

const sheet = () => document.querySelector('[data-slot="sheet-content"][data-placement="bottom"]')
const centred = () => document.querySelector('[data-slot="alert-dialog"]')

describe('useConfirm', () => {
  afterEach(() => resizeViewportTo(1024))

  /**
   * A question reaches for the bottom edge on a phone and the middle of the
   * screen on a desktop, and is the same question either way: same role, same
   * two buttons, same answer on a dismissal.
   */
  it('rises from the bottom edge on a phone and sits centred elsewhere', async () => {
    resizeViewportTo(500)
    const answer = vi.fn()
    render(<Harness onAnswer={answer} />)
    await click('ask')

    expect(sheet()).not.toBeNull()
    expect(centred()).toBeNull()
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    await click(i18n.t('common.cancel'))
    expect(answer).toHaveBeenCalledWith(false)
  })

  it('stays centred on a phone when the asker says so', async () => {
    resizeViewportTo(500)
    function Centred() {
      const { confirm, confirmDialog } = useConfirm()
      return (
        <>
          <button onClick={() => void confirm({ body: 'Sure?', presentation: 'center' })}>ask</button>
          {confirmDialog}
        </>
      )
    }
    render(<Centred />)
    await click('ask')

    expect(centred()).not.toBeNull()
    expect(sheet()).toBeNull()
  })

  it('renders nothing until something is asked', () => {
    const { container } = render(<Harness onAnswer={() => {}} />)
    expect(container.textContent).toBe('ask')
    expect(screen.queryByText('Sure?')).not.toBeInTheDocument()
  })

  it('answers yes only for the confirming button', async () => {
    const answer = vi.fn()
    render(<Harness onAnswer={answer} />)

    await click('ask')
    await click(i18n.t('common.confirm'))
    expect(answer).toHaveBeenCalledWith(true)

    answer.mockClear()
    await click('ask')
    await click(i18n.t('common.cancel'))
    expect(answer).toHaveBeenCalledWith(false)
  })

  /**
   * Only reachable from code: the dialog is modal, so once it is up there is no
   * button left to press. Asked twice anyway, the first caller has to hear back
   * — left dangling it would sit awaiting an answer that the dialog, now
   * showing a different question, can no longer give.
   */
  it('answers no to a question a second one interrupts', async () => {
    const askRef: { current: Ask | null } = { current: null }
    render(<Harness onAnswer={() => {}} askRef={askRef} />)

    const first = vi.fn()
    const second = vi.fn()
    await act(async () => {
      void askRef.current!('first').then(first)
      void askRef.current!('second').then(second)
    })

    expect(first).toHaveBeenCalledWith(false)
    expect(second).not.toHaveBeenCalled()
    expect(screen.getByText('second')).toBeInTheDocument()

    await click(i18n.t('common.confirm'))
    expect(second).toHaveBeenCalledWith(true)
  })

  /**
   * The back gesture is the fourth way out, and it has to settle the promise
   * like the other three. Escape and the scrim deliberately do not close this
   * dialog, and back is not one of those: without a level of its own the gesture
   * went straight past the question to whatever was behind it — closing the
   * sidebar sheet under the scrim, and then leaving the app entirely with a
   * destructive question still on screen.
   */
  it('answers no to the back gesture, and claims a level to catch it', async () => {
    const entries: Array<{ __meridianDepth: number } | null> = [null]
    let index = 0
    vi.stubGlobal('history', {
      get state() {
        return entries[index]
      },
      pushState(state: { __meridianDepth: number }) {
        entries.splice(index + 1)
        entries.push(state)
        index = entries.length - 1
      },
      go(delta: number) {
        const next = Math.max(0, Math.min(entries.length - 1, index + delta))
        if (next === index) return
        index = next
        window.dispatchEvent(new PopStateEvent('popstate', { state: entries[index] }))
      },
    })
    useHistoryStore.setState({ enabled: true, levels: [] })
    const detach = attachHistory()

    try {
      const answer = vi.fn()
      render(<Harness onAnswer={answer} />)

      await click('ask')
      expect(screen.getByText('Sure?')).toBeInTheDocument()
      expect(useHistoryStore.getState().levels).toHaveLength(1)

      await act(async () => {
        window.history.go(-1)
      })

      expect(answer).toHaveBeenCalledWith(false)
      expect(useHistoryStore.getState().levels).toHaveLength(0)
    } finally {
      detach()
      useHistoryStore.setState({ enabled: false, levels: [] })
      vi.unstubAllGlobals()
    }
  })

  /**
   * One question, one press of the back key.
   *
   * On a phone the dialog *is* a `Sheet`, which claims a level of its own. A
   * second claim beside it would leave the first press appearing to do nothing.
   */
  it('costs one history level as a sheet, the same as centred', async () => {
    resizeViewportTo(500)
    useHistoryStore.setState({ enabled: true, levels: [] })
    try {
      render(<Harness onAnswer={() => {}} />)
      await click('ask')
      await act(async () => {})
      expect(sheet()).not.toBeNull()
      expect(useHistoryStore.getState().levels).toHaveLength(1)
    } finally {
      useHistoryStore.setState({ enabled: false, levels: [] })
    }
  })
})
