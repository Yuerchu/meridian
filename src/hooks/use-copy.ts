import { useCallback, useEffect, useRef, useState } from 'react'

import { errorMessage } from '@/lib/error-message'
import { writeClipboard } from '@/lib/clipboard'
import { useTemporaryFlag } from './use-temporary-flag'

/**
 * A copy button's state: the tick once the clipboard has taken the text, and
 * the reason when it has not.
 *
 * The tick waits for the write. Drawn on press, it claimed a copy the clipboard
 * had refused, and the next paste put something else wherever it went. The
 * tick still falls on its own; a failure does not — an error that flashes and
 * goes is one the reader has to go to the log for — and stays until the next
 * press.
 *
 * Only the latest press may settle the state. Two quick presses whose writes
 * answer out of order would otherwise leave the first one's outcome showing,
 * and a write that answers after the button is gone settles nothing.
 */
export function useCopy(ms?: number) {
  const [copied, markCopied, lowerCopied] = useTemporaryFlag(ms)
  const [failure, setFailure] = useState<string | null>(null)
  const latest = useRef(0)

  useEffect(
    () => () => {
      latest.current += 1
    },
    [],
  )

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      const attempt = ++latest.current
      try {
        await writeClipboard(text)
      } catch (reason) {
        if (attempt === latest.current) {
          lowerCopied()
          setFailure(errorMessage(reason))
        }
        return false
      }
      if (attempt === latest.current) {
        setFailure(null)
        markCopied()
      }
      return true
    },
    [lowerCopied, markCopied],
  )

  return { copied, failure, copy }
}
