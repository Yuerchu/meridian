import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { render } from '@testing-library/react'
import { AgentThinking } from '@/components/application/agent-thinking/agent-thinking'
import { ShimmerText } from '@/components/application/agent-log/agent-log'

/**
 * The "working" shimmer is a class that points at a stylesheet, and jsdom runs
 * with `css: false`, so nothing else would notice the class naming nothing.
 * That is how the HeroUI-era `shimmer` class outlived its stylesheet and every
 * "thinking" label stopped moving. `animation-needs-keyframes` covers the
 * `animate-[…]` spelling; this covers the class spelling, for the two official
 * boardui components the app draws its working states with: agent-thinking's
 * label and agent-log's `ShimmerText`.
 */
function stylesheets(dir: string): string {
  return readdirSync(dir, { withFileTypes: true })
    .map((entry) => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return stylesheets(full)
      return entry.name.endsWith('.css') ? readFileSync(full, 'utf8') : ''
    })
    .join('\n')
}

function assertAnimatedWithGuard(element: Element) {
  const classes = [...element.classList]
  const css = stylesheets(resolve(process.cwd(), 'src'))

  const animated = classes
    .map((name) => {
      const rule = new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css)?.[1]
      const keyframes = rule && /animation:\s*([\w-]+)/.exec(rule)?.[1]
      return keyframes ? { name, keyframes } : null
    })
    .find(Boolean)

  expect(animated, `none of ${classes.join(' ')} has an animation rule`).toBeTruthy()
  expect(css).toMatch(new RegExp(`@keyframes\\s+${animated!.keyframes}\\b`))
  expect(css).toMatch(
    new RegExp(`prefers-reduced-motion:\\s*reduce\\)\\s*\\{[^@]*\\.${animated!.name}\\s*\\{[^}]*animation:\\s*none`),
  )
}

describe('official working shimmers', () => {
  it("agent-thinking's label animates keyframes that exist, with a reduced-motion fallback", () => {
    const { container } = render(<AgentThinking variant="infinity" label="Thinking" showTimer={false} />)
    const label = container.querySelector('.bui-agent-thinking-label')!
    assertAnimatedWithGuard(label)
    const status = container.querySelector('[role="status"]') as HTMLElement
    expect(status.style.getPropertyValue('--bui-agent-thinking-tone')).not.toBe('')
  })

  it("agent-log's ShimmerText animates keyframes that exist, with a reduced-motion fallback", () => {
    const { container } = render(<ShimmerText>Reading files</ShimmerText>)
    assertAnimatedWithGuard(container.querySelector('.agent-progress-loading-text')!)
  })
})
