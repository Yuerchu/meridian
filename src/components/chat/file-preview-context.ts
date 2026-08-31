import * as React from 'react'

import type { MarkdownFileReference } from '@/lib/markdown-target'

export interface FilePreviewContextValue {
  openPreview: (reference: MarkdownFileReference) => void
  probeReference: (path: string) => Promise<boolean>
}

export const FilePreviewContext = React.createContext<FilePreviewContextValue | null>(null)

export function useFilePreview(): FilePreviewContextValue | null {
  return React.useContext(FilePreviewContext)
}
