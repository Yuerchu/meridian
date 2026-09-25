/**
 * The words a failure is shown in.
 *
 * The backend rejects with a plain string — Tauri's `invoke` and the remote
 * transport both do — and that string is already written for a person, so it
 * is shown as it is. A thrown `Error` is shown by its message: `String(error)`
 * would put "Error: " in front of every one of them, which is the runtime's
 * vocabulary rather than the reader's.
 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The rejections among several requests made side by side, each named by what
 * it was for — `"OpenAI: 401 Unauthorized; DeepSeek: timed out"` — or null when
 * none failed. For `Promise.allSettled` over a list, where a single "failed"
 * would not say which of them, and dropping the rejected ones silently is how
 * a provider's models went missing from the picker with nothing said.
 */
export function describeRejections(labels: readonly string[], results: readonly PromiseSettledResult<unknown>[]) {
  const failures = results.flatMap((result, i) =>
    result.status === 'rejected' ? [`${labels[i]}: ${errorMessage(result.reason)}`] : [],
  )
  return failures.length > 0 ? failures.join('; ') : null
}
