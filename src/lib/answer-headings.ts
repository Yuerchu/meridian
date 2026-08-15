/**
 * The headings of an answer, read back off the DOM the transcript rendered.
 *
 * Reading rather than parsing, which is the opposite of what it looks like it
 * should be. Pro's `Markdown` renders every top-level block as its own memoised
 * `ReactMarkdown`, so there is no shared counter to mint stable ids from and
 * `node.position` is block-local — injecting ids during render is closed off.
 * Reading is not: nothing here writes to the DOM, node identity never has to
 * survive anything because every element is looked up again on the frame it is
 * used, and a `#` inside a code fence never became an `<h1>` to begin with, so
 * fenced code needs no handling at all.
 */

/**
 * Positive on the message, so a heading has to be inside an answer to count.
 * `data-role` is set by `MessageAssistant` — side of the screen is a layout
 * consequence and cannot be queried.
 */
const ANSWER = '[data-role="assistant"] :is(h1,h2,h3,h4,h5,h6)'

/**
 * Negative on the two regions inside a turn that also render markdown. A tool
 * result or a reasoning trace can contain any markup at all, and its headings
 * are not part of the answer's structure.
 */
const NOT_ANSWER = '[data-slot="turn-content"],[data-slot="turn-pinned"]'

export interface AnswerHeading {
  element: HTMLElement
  text: string
  /** Nesting depth, 1-based within this answer rather than the tag's own. */
  level: number
}

/** `turn` is the `[data-slot="turn"]` element. */
export function readAnswerHeadings(turn: Element): AnswerHeading[] {
  const found = [...turn.querySelectorAll<HTMLElement>(ANSWER)]
    .filter((el) => !el.closest(NOT_ANSWER))
    .map((element) => ({
      element,
      text: element.textContent?.trim() ?? '',
      level: Number(element.tagName[1]),
    }))
    .filter((entry) => entry.text.length > 0)

  // An answer that opens at `##` is not indented for it. The bars get shorter
  // with depth, and depth here means "relative to this answer".
  const top = Math.min(...found.map((entry) => entry.level))
  return found.map((entry) => ({ ...entry, level: entry.level - top + 1 }))
}
