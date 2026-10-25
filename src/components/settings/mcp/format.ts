/** Compact token counts for the MCP settings meter. Integer in, display string out. */
export function formatDefinitionTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const tenths = Math.round(tokens / 100_000)
    return tenths % 10 === 0 ? `${tenths / 10}M` : `${(tenths / 10).toFixed(1)}M`
  }
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}k`
  if (tokens >= 1000) {
    const tenths = Math.round(tokens / 100)
    return tenths % 10 === 0 ? `${tenths / 10}k` : `${(tenths / 10).toFixed(1)}k`
  }
  return String(tokens)
}
