import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('component stylesheet precedence', () => {
  it('establishes layer order in the document before scripts or stylesheets can create a layer', () => {
    const html = readFileSync('index.html', 'utf8')
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'))
    const layers = head.indexOf('@layer theme, base, components, utilities;')
    expect(layers).toBeGreaterThanOrEqual(0)
    expect(head.lastIndexOf('<style>', layers)).toBeGreaterThanOrEqual(0)
    expect(layers).toBeLessThan(head.indexOf('<script'))
    const stylesheet = head.search(/<link[^>]+rel=["']stylesheet["']/)
    if (stylesheet >= 0) expect(layers).toBeLessThan(stylesheet)
  })
})
