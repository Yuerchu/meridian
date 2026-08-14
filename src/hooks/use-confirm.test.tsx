import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import i18n from '@/i18n'
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

describe('useConfirm', () => {
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
})
