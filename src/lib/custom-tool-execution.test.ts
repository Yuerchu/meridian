import { describe, expect, it } from 'vitest'
import { parseCustomToolExecution } from './custom-tool-execution'

describe('typed custom tool execution', () => {
  it('preserves fixed source and hostile literal data exactly', () => {
    for (const value of ['', 'two words', '\'"\\', 'line\nnext', '雪', '$(touch INJECTED); &|<>', '{{other}}']) {
      const definition = { kind: 'script', script: 'printf "%s" "$1"', args: [{ kind: 'literal', value }] }
      expect(parseCustomToolExecution(definition)).toEqual(definition)
    }
    const definition = {
      kind: 'executable',
      program: 'python',
      args: [{ kind: 'literal', value: 'tool.py' }, { kind: 'parameter', name: 'input' }, { kind: 'json' }],
    }
    expect(parseCustomToolExecution(definition)).toEqual(definition)
  })

  it.each([
    null,
    [],
    'echo {{x}}',
    { kind: 'template', command: 'echo' },
    { kind: 'executable', program: '', args: [] },
    { kind: 'executable', program: 'echo', args: [], extra: true },
    { kind: 'script', script: 'echo', args: [{ kind: 'json', extra: true }] },
    { kind: 'script', script: 'echo', args: [{ kind: 'parameter', name: '' }] },
    { kind: 'script', script: 'echo', args: [{ kind: 'literal', value: 'a\0b' }] },
    { kind: 'script', script: 'echo', args: ['untyped'] },
  ])('rejects malformed or obsolete definitions: %j', (value) => {
    expect(() => parseCustomToolExecution(value)).toThrow()
  })
})
