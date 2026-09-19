import * as React from 'react'

import { cx } from '@/utils/cx'
import { splitPath } from '@/lib/paths'

/**
 * A path, drawn so the file's name is the part that survives.
 *
 * On a key the directory is what gives, from its end, and the name is never
 * clipped — `…/agent/engine/` says less than `turn.rs`, and a key that showed
 * the first forty characters of an absolute path showed the same
 * `C:/Users/Administrator/Documents/` on every one of them. In `wrap` mode
 * nothing is clipped at all: a panel header, or a key waiting on a decision,
 * shows the whole path and breaks it wherever the width runs out.
 *
 * The text nodes concatenate to the exact path, with nothing inserted, so a
 * caller that reads the label back gets the string it was given.
 */
function PathLabel({
  path,
  wrap = false,
  className,
  ...props
}: Omit<React.ComponentProps<'span'>, 'children'> & { path: string; wrap?: boolean }) {
  const { dir, name } = splitPath(path)
  return (
    <span
      data-slot="path-label"
      className={cx(
        'max-w-full min-w-0 font-mono',
        wrap ? 'inline whitespace-pre-wrap break-all' : 'inline-flex whitespace-nowrap',
        className,
      )}
      {...props}
    >
      {dir !== '' && (
        <span data-slot="path-dir" className={cx('text-text-secondary', !wrap && 'min-w-0 truncate')}>
          {dir}
        </span>
      )}
      <span data-slot="path-name" className="shrink-0 text-text-primary">
        {name}
      </span>
    </span>
  )
}

export { PathLabel }
