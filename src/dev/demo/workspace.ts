import type { WorkspaceFileContentResponse, WorkspaceGitStatusResponse, WorkspaceTreeEntryInfoResponse } from '@/types'

/** A small pretend checkout, enough for the file preview and changes panel. */
export const FILES: Record<string, string> = {
  'package.json': '{\n  "name": "meridian",\n  "version": "0.3.0",\n  "private": true\n}\n',
  'README.md':
    '# Meridian\n\nMulti-provider AI desktop client with coding agent capabilities.\n\n- Tauri v2\n- React 19\n',
  'src/lib/transport.ts':
    'export const transport: Transport = remote ?? demo ?? tauriTransport\n\nexport const isRemote = remote !== null\n',
  'src/lib/message-scroller.tsx':
    "import * as React from 'react'\n\nexport type ScrollMode = 'follow' | 'idle'\n\nexport function MessageScroller() {\n  const [mode, setMode] = React.useState<ScrollMode>('follow')\n  React.useEffect(() => {\n    if (mode === 'follow') follow()\n  })\n  return null\n}\n\nfunction follow() {}\n",
  'src/components/chat/chat-transcript.tsx':
    'export function ChatTranscript() {\n  return <div data-slot="chat-transcript" />\n}\n',
}

const DIRS = ['src', 'src/lib', 'src/components', 'src/components/chat', 'src/dev', 'src/dev/demo']

export function tree(dir: string | null): WorkspaceTreeEntryInfoResponse[] {
  const prefix = dir ? `${dir}/` : ''
  const direct = (path: string) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/')
  const dirs = DIRS.filter(direct).map((path) => ({ name: path.slice(prefix.length), rel_path: path, is_dir: true }))
  const files = Object.keys(FILES)
    .filter(direct)
    .map((path) => ({ name: path.slice(prefix.length), rel_path: path, is_dir: false }))
  return [...dirs, ...files]
}

export function readFile(relPath: string): WorkspaceFileContentResponse | null {
  const content = FILES[relPath]
  if (content === undefined) return null
  return {
    content,
    truncated: false,
    total_lines: content.split('\n').length,
    size_bytes: new TextEncoder().encode(content).length,
    binary: false,
  }
}

export const GIT_STATUS: WorkspaceGitStatusResponse = {
  state: 'ok',
  branch: 'refactor/boardui-constitution',
  files: [
    { path: 'src/lib/message-scroller.tsx', status: 'modified', renamed_from: null },
    { path: 'src/components/chat/chat-transcript.tsx', status: 'modified', renamed_from: null },
    { path: 'src/dev/demo/index.ts', status: 'untracked', renamed_from: null },
  ],
}

export function gitDiff(relPath: string | null): string {
  const one = (path: string) =>
    [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      '@@ -6,4 +6,3 @@',
      '   React.useEffect(() => {',
      '-    if (anchored) viewport.scrollTo({ top: anchorTop })',
      '-    else follow()',
      "+    if (mode === 'follow') follow()",
      '   })',
    ].join('\n')
  return relPath ? one(relPath) : GIT_STATUS.state === 'ok' ? GIT_STATUS.files.map((f) => one(f.path)).join('\n') : ''
}
