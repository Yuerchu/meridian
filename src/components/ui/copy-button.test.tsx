import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { CopyButton } from './copy-button'

/**
 * The button drew its tick on the press, before the clipboard had answered, so
 * a refused write looked exactly like a good one.
 */
describe('CopyButton', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })

  // After `userEvent.setup()`, which installs a clipboard of its own.
  function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  }

  function deferred() {
    let resolve!: () => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  it('says copied only once the clipboard has taken the text', async () => {
    const user = userEvent.setup()
    const write = deferred()
    stubClipboard(vi.fn().mockReturnValue(write.promise))
    render(<CopyButton text="hello" />)

    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('')

    await act(async () => write.resolve())
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Copied')
  })

  it('keeps a refusal, with its reason, until the next press', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockRejectedValueOnce(new Error('Document is not focused.')).mockResolvedValue(undefined)
    stubClipboard(writeText)
    render(<CopyButton text="hello" />)

    await user.click(screen.getByRole('button', { name: 'Copy' }))
    const refused = await screen.findByRole('button', { name: 'Copy failed: Document is not focused.' })
    expect(screen.getByRole('status')).toHaveTextContent('Copy failed: Document is not focused.')

    await user.click(refused)
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('shows the outcome of the latest press when an earlier write answers late', async () => {
    const user = userEvent.setup()
    const first = deferred()
    stubClipboard(vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(undefined))
    render(<CopyButton text="hello" />)

    await user.click(screen.getByRole('button', { name: 'Copy' }))
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()

    await act(async () => first.reject(new Error('Document is not focused.')))
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })
})
