/**
 * Reading the strings tools return back into the parts a panel draws.
 *
 * Every tool result is one string — stdout, stderr and the exit code of a
 * command are already joined by the time they reach the transcript, and a
 * sub-agent's verdict is a sentence in front of its report. Nothing marks
 * those parts on the wire; the templates are fixed in the backend
 * (`run_command.rs`'s `formatted()`, `turn.rs`'s `sub_agent_result`,
 * `truncate.rs`), and these parsers match them exactly. A string that matches
 * nothing is passed through whole rather than guessed at, so a hosted agent's
 * tool — which writes its own output with no markers — draws as plain text
 * and never as a wrong exit code.
 */

export interface TruncationInfo {
  /** The token count the backend reported before it cut the output. */
  originalTokens: number
  /** Whether a `…N tokens truncated…` seam was found inside the body. */
  seam: boolean
}

export interface SplitTruncation {
  body: string
  truncation: TruncationInfo | null
}

const TRUNCATION_HEADER = /^Warning: truncated output \(original token count: (\d+)\)\nTotal output lines: \d+\n\n/
const TRUNCATION_SEAM = /\n?…\d+ tokens truncated…\n?/

/**
 * The whole-result truncation the turn loop applies to any tool's output,
 * taken off the front so every other parser sees the string the tool wrote.
 * Runs first, always: a sub-agent report or a command's markers can be inside
 * it.
 */
export function splitTruncation(result: string): SplitTruncation {
  const header = TRUNCATION_HEADER.exec(result)
  if (!header) return { body: result, truncation: null }
  const rest = result.slice(header[0].length)
  const seam = TRUNCATION_SEAM.test(rest)
  return {
    body: seam ? rest.replace(TRUNCATION_SEAM, '\n\n') : rest,
    truncation: { originalTokens: Number(header[1]), seam },
  }
}

export interface CommandOutput {
  stdout: string
  stderr: string
  /** `null` is "not reported": the backend writes the code only when it is
   *  non-zero and the command did not time out, and a hosted agent's shell
   *  writes none at all. Not `0`, which would claim a success nobody stated. */
  exitCode: number | null
  timedOut: boolean
  /** The command's own 256 KB cap, distinct from the turn-level truncation. */
  truncated: boolean
  noOutput: boolean
}

const OUTPUT_TRUNCATED = '[output truncated at 256KB]'
const TIMED_OUT = '[timed out; process tree killed]'
const EXIT_CODE = /\n?\[exit code: (-?\d+)\]$/
const STDERR_MARK = '[stderr] '

function stripTrailer(text: string, marker: string): [string, boolean] {
  if (!text.endsWith(marker)) return [text, false]
  const cut = text.slice(0, -marker.length)
  return [cut.endsWith('\n') ? cut.slice(0, -1) : cut, true]
}

/**
 * `run_command`'s result, in the order `formatted()` writes it: stdout, then
 * `[stderr] …`, then the trailers. Peeled from the end so a program whose own
 * output happens to contain `[stderr]` on a later line is still split at the
 * first marker the backend wrote.
 */
export function parseCommandOutput(result: string): CommandOutput {
  if (result === '(no output)') {
    return { stdout: '', stderr: '', exitCode: null, timedOut: false, truncated: false, noOutput: true }
  }
  const [afterCap, truncated] = stripTrailer(result, OUTPUT_TRUNCATED)
  const [afterTimeout, timedOut] = stripTrailer(afterCap, TIMED_OUT)
  let text = afterTimeout
  let exitCode: number | null = null
  const exit = EXIT_CODE.exec(text)
  if (exit) {
    exitCode = Number(exit[1])
    text = text.slice(0, exit.index)
  }
  let stdout = text
  let stderr = ''
  if (text.startsWith(STDERR_MARK)) {
    stdout = ''
    stderr = text.slice(STDERR_MARK.length)
  } else {
    const at = text.indexOf(`\n${STDERR_MARK}`)
    if (at !== -1) {
      stdout = text.slice(0, at)
      stderr = text.slice(at + 1 + STDERR_MARK.length)
    }
  }
  return { stdout, stderr, exitCode, timedOut, truncated, noOutput: false }
}

export type SubAgentOutcome = 'done' | 'cancelled' | 'aborted' | 'failed'

export interface SubAgentResult {
  /** `null` when the first line is not one the backend writes: an older row,
   *  a hosted agent's `Task`, or an error string. */
  outcome: SubAgentOutcome | null
  steps: number | null
  /** The report itself, with the verdict sentence and the stranded note
   *  taken off. Empty when the run returned no text. */
  body: string
  /** Messages the user sent after the run stopped reading — a paragraph the
   *  backend appends so the parent model reads them before acting. */
  stranded: string | null
}

// The whole first line: the verdict, then whatever the backend adds to it
// ("because it kept repeating itself", "It returned no text.").
const SUB_AGENT_HEAD = /^Sub-agent (finished|was stopped|failed) after (\d+) steps?\b([^\n]*)/
const STRANDED = /\n\n(The user sent \d+ message\(s\) to the sub-agent after it had stopped reading[^\n]*)$/

/**
 * `sub_agent_result`'s three parts. The head sentence decides the outcome:
 * `finished` is done, `failed` is failed, and `was stopped` is cancelled
 * unless the sentence goes on to say the run kept repeating itself, which is
 * the loop guard's abort. Anything after the head on its first line is the
 * backend's own qualification of the verdict and not part of the report.
 */
export function parseSubAgentResult(result: string): SubAgentResult {
  let text = result
  let stranded: string | null = null
  const tail = STRANDED.exec(text)
  if (tail) {
    stranded = tail[1]
    text = text.slice(0, tail.index)
  }
  const head = SUB_AGENT_HEAD.exec(text)
  if (!head) return { outcome: null, steps: null, body: text.trim(), stranded }
  const verb = head[1]
  const qualifier = head[3]
  const outcome: SubAgentOutcome =
    verb === 'finished'
      ? 'done'
      : verb === 'failed'
        ? 'failed'
        : /repeating itself/.test(qualifier)
          ? 'aborted'
          : 'cancelled'
  // "It returned no text." rides the head's own line, so it is already inside
  // the qualifier and the body is what follows: nothing.
  return { outcome, steps: Number(head[2]), body: text.slice(head[0].length).trim(), stranded }
}

export interface ReadFileOutput {
  content: string
  /** Set when the tool cut the file at its own 256 KB cap. */
  truncated: { totalBytes: number | null } | null
}

const READ_TRUNCATED = /\.\.\.\n\n\(file truncated at 256KB(?:, total (\d+) bytes)?\)$/

/** `read_file`'s tail, which is appended to the content rather than marked. */
export function parseReadFileOutput(result: string): ReadFileOutput {
  const m = READ_TRUNCATED.exec(result)
  if (!m) return { content: result, truncated: null }
  return {
    content: result.slice(0, m.index),
    truncated: { totalBytes: m[1] ? Number(m[1]) : null },
  }
}

export interface ListingFootnote {
  /** The `(showing first N matches)` cap, when the tool hit it. */
  showingFirst: number | null
}

const SHOWING_FIRST = /\n\n\(showing first (\d+) matches\)$/

/** Takes the cap note off a search or glob result. */
export function splitListingFootnote(result: string): { body: string; footnote: ListingFootnote } {
  const m = SHOWING_FIRST.exec(result)
  if (!m) return { body: result, footnote: { showingFirst: null } }
  return { body: result.slice(0, m.index), footnote: { showingFirst: Number(m[1]) } }
}

export interface SearchMatch {
  file: string
  line: number
  text: string
}

const SEARCH_LINE = /^(.+?):(\d+):(.*)$/

/** `search_files`: one `path:line:text` per line. `null` when nothing matches
 *  that shape, which is what "No matches found." and an error string are. */
export function parseSearchMatches(body: string): SearchMatch[] | null {
  const matches: SearchMatch[] = []
  for (const line of body.split('\n')) {
    if (!line) continue
    const m = SEARCH_LINE.exec(line)
    if (m) matches.push({ file: m[1], line: Number(m[2]), text: m[3] })
  }
  return matches.length > 0 ? matches : null
}

export const NO_SEARCH_MATCHES = 'No matches found.'
const NO_GLOB_MATCHES = /^No files matching '.*' found\.$/

/** `glob`: one relative path per line, or its own no-match sentence. */
export function parseGlobResult(body: string): { paths: string[]; empty: boolean } {
  if (NO_GLOB_MATCHES.test(body.trim())) return { paths: [], empty: true }
  const paths = body.split('\n').filter((line) => line !== '')
  return { paths, empty: paths.length === 0 }
}

export type DirectoryEntryKind = 'dir' | 'file' | 'link'

export interface DirectoryEntry {
  kind: DirectoryEntryKind
  /** As the tool printed it: `1.2 KB`, `312 B`; `null` for a directory. */
  size: string | null
  name: string
}

export const EMPTY_DIRECTORY = '(empty directory)'
const DIRECTORY_LINE = /^(dir |link|file) {2}( {0,7}[^ ].*?|-) {2}(.+)$/

/**
 * `list_directory`: `{kind}  {size:>8}  {name}` per line, the kind padded to
 * four characters so `dir` carries a trailing space. The backend sorts the
 * formatted lines, which puts directories first; the order is kept as is.
 * `null` when a line does not fit, which means the whole result is something
 * else — an error, most likely — and is shown as text.
 */
export function parseDirectoryListing(body: string): DirectoryEntry[] | null {
  if (body.trim() === EMPTY_DIRECTORY) return []
  const entries: DirectoryEntry[] = []
  for (const line of body.split('\n')) {
    if (line === '') continue
    const m = DIRECTORY_LINE.exec(line)
    if (!m) return null
    const size = m[2].trim()
    entries.push({ kind: m[1].trim() as DirectoryEntryKind, size: size === '-' ? null : size, name: m[3] })
  }
  return entries
}

/** A one-sentence confirmation, which the mutating tools return: short, one
 *  line, and nothing a person needs a code box to read. */
export function isOneLiner(result: string): boolean {
  const trimmed = result.trim()
  return trimmed !== '' && trimmed.length <= 240 && !trimmed.includes('\n')
}
