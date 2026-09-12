import { buildFileTree, touchedFiles } from './touched-files'
import type { ContentBlock, MessageViewModel, ToolCallDisplay } from '@/types'

function call(
  tool_name: string,
  args: Record<string, unknown>,
  status: ToolCallDisplay['status'] = 'completed',
): ContentBlock {
  return {
    type: 'tool_call',
    data: { call_id: `${tool_name}-${Math.abs(0)}`, tool_name, arguments: JSON.stringify(args), status },
  }
}

const msg = (...blocks: ContentBlock[]): MessageViewModel =>
  ({ id: 'm', role: 'assistant', _blocks: blocks }) as unknown as MessageViewModel

describe('touchedFiles', () => {
  it('reads a path out of each file tool', () => {
    const files = touchedFiles([
      msg(
        call('write_file', { path: 'a.ts', content: 'x' }),
        call('edit_file', { file_path: 'b.ts', old_string: 'x', new_string: 'y' }),
        call('delete_file', { path: 'c.ts' }),
      ),
    ])
    expect(files).toEqual([
      { path: 'a.ts', op: 'modify', count: 1 },
      { path: 'b.ts', op: 'modify', count: 1 },
      { path: 'c.ts', op: 'delete', count: 1 },
    ])
  })

  it('reads a hosted Claude Code edit the same way', () => {
    // `Write` keeps its path under `file_path`, where `write_file` has `path`.
    const files = touchedFiles([
      msg(
        call('Write', { file_path: 'a.ts', content: 'x' }),
        call('Edit', { file_path: 'b.ts', old_string: 'x', new_string: 'y' }),
      ),
    ])
    expect(files).toEqual([
      { path: 'a.ts', op: 'modify', count: 1 },
      { path: 'b.ts', op: 'modify', count: 1 },
    ])
  })

  it('splits a move into the two facts it is', () => {
    // One call, two paths: the origin is gone and the destination is new.
    const files = touchedFiles([msg(call('move_file', { from: 'old.ts', to: 'new.ts' }))])
    expect(files).toEqual([
      { path: 'new.ts', op: 'create', count: 1 },
      { path: 'old.ts', op: 'delete', count: 1 },
    ])
  })

  it('ignores calls that never ran', () => {
    // A denied write would otherwise put a file in the panel that is not on
    // disk, which is worse than leaving one out.
    expect(
      touchedFiles([
        msg(
          call('write_file', { path: 'denied.ts', content: 'x' }, 'denied'),
          call('write_file', { path: 'failed.ts', content: 'x' }, 'error'),
          call('write_file', { path: 'pending.ts', content: 'x' }, 'pending'),
        ),
      ]),
    ).toEqual([])
  })

  it('ignores tools that touch no file', () => {
    expect(
      touchedFiles([msg(call('read_file', { path: 'a.ts' }), call('run_command', { command: 'rm -rf b.ts' }))]),
    ).toEqual([])
  })

  it('rejects malformed arguments on a completed call', () => {
    const blocks = [call('write_file', { path: 'a.ts' })]
    ;(blocks[0] as { data: ToolCallDisplay }).data.arguments = '{"path": "a.ts"'
    expect(() => touchedFiles([msg(...blocks)])).toThrow('completed write_file arguments is invalid JSON')
  })

  it('rejects non-object arguments on a completed call', () => {
    const blocks = [call('write_file', { path: 'a.ts' })]
    ;(blocks[0] as { data: ToolCallDisplay }).data.arguments = '[]'
    expect(() => touchedFiles([msg(...blocks)])).toThrow('completed write_file arguments must be an object')
  })

  describe('folding a file down to one verb', () => {
    const opOf = (...blocks: ContentBlock[]) => touchedFiles([msg(...blocks)])[0]

    it('keeps create when the new file is then edited', () => {
      // It did not exist before this conversation, which is the fact worth
      // keeping — "modified" would hide that.
      const f = opOf(
        call('move_file', { from: 'x.ts', to: 'a.ts' }),
        call('edit_file', { file_path: 'a.ts', old_string: 'p', new_string: 'q' }),
      )
      expect(f).toEqual({ path: 'a.ts', op: 'create', count: 2 })
    })

    it('lets delete win over anything before it', () => {
      expect(opOf(call('write_file', { path: 'a.ts', content: 'x' }), call('delete_file', { path: 'a.ts' }))).toEqual({
        path: 'a.ts',
        op: 'delete',
        count: 2,
      })
    })

    it('calls delete-then-write a modify', () => {
      // The path exists at the end and existed at the start; calling that a
      // create would claim something about a file that was already there.
      expect(opOf(call('delete_file', { path: 'a.ts' }), call('write_file', { path: 'a.ts', content: 'x' }))).toEqual({
        path: 'a.ts',
        op: 'modify',
        count: 2,
      })
    })

    it('counts every call that landed on the file', () => {
      expect(
        opOf(
          call('edit_file', { file_path: 'a.ts', old_string: '1', new_string: '2' }),
          call('edit_file', { file_path: 'a.ts', old_string: '2', new_string: '3' }),
          call('edit_file', { file_path: 'a.ts', old_string: '3', new_string: '4' }),
        ).count,
      ).toBe(3)
    })
  })

  it('reads every file out of a unified patch', () => {
    const patch = [
      '--- a/one.ts',
      '+++ b/one.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
      '--- /dev/null',
      '+++ b/two.ts',
      '@@ -0,0 +1 @@',
      '+new',
      '--- a/three.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-gone',
    ].join('\n')
    expect(touchedFiles([msg(call('apply_patch', { patch }))])).toEqual([
      { path: 'one.ts', op: 'modify', count: 1 },
      { path: 'three.ts', op: 'delete', count: 1 },
      { path: 'two.ts', op: 'create', count: 1 },
    ])
  })

  it('reads a move out of a codex patch as two paths', () => {
    const patch = [
      '*** Begin Patch',
      '*** Update File: src/old.ts',
      '*** Move to: src/new.ts',
      '@@',
      '-a',
      '+b',
      '*** End Patch',
    ].join('\n')
    expect(touchedFiles([msg(call('apply_patch', { patch }))])).toEqual([
      { path: 'src/new.ts', op: 'modify', count: 1 },
      { path: 'src/old.ts', op: 'delete', count: 1 },
    ])
  })
})

describe('buildFileTree', () => {
  const file = (path: string) => ({ path, op: 'modify' as const, count: 1 })

  it('nests by directory', () => {
    const tree = buildFileTree([file('src/a.ts'), file('src/b.ts')])
    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('src')
    expect(tree[0].children?.map((c) => c.name)).toEqual(['a.ts', 'b.ts'])
  })

  it('collapses a chain of single-child directories into one row', () => {
    // Four rows to reach one file, three of which say nothing.
    const tree = buildFileTree([file('src/components/chat/x.tsx')])
    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('src/components/chat')
    expect(tree[0].id).toBe('src/components/chat')
    expect(tree[0].children?.[0].name).toBe('x.tsx')
  })

  it('stops collapsing where the tree actually branches', () => {
    const tree = buildFileTree([file('src/a/x.ts'), file('src/b/y.ts')])
    expect(tree[0].name).toBe('src')
    expect(tree[0].children?.map((c) => c.name)).toEqual(['a', 'b'])
  })

  it('takes both separators, because one transcript mixes them', () => {
    const tree = buildFileTree([file('src\\a.ts'), file('src/b.ts')])
    expect(tree).toHaveLength(1)
    expect(tree[0].children?.map((c) => c.name)).toEqual(['a.ts', 'b.ts'])
  })

  it('keeps a file that lives at the root', () => {
    const tree = buildFileTree([file('README.md')])
    expect(tree).toEqual([{ id: 'README.md', name: 'README.md', file: file('README.md') }])
  })
})
