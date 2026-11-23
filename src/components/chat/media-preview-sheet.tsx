import './media-preview-sheet.css'
import * as React from 'react'
import { Download } from '@keyline-icons/react/two-tone'
import { save } from '@tauri-apps/plugin-dialog'
import { useTranslation } from 'react-i18next'

import { api } from '@/api'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Drawer } from '@/components/yuerchu-ui/components/drawer/drawer'
import { ImageViewer, type ImageViewerImage } from '@/components/yuerchu-ui/components/image-viewer/image-viewer'
import { useHistoryLevel } from '@/hooks/use-history-level'
import { assetSrc } from '@/lib/asset-src'
import { can } from '@/lib/capabilities'
import type { ToolMediaResponse } from '@/types'

/** What the save dialog offers as the file name: the tool's own name for it,
 *  or the last segment of where it was stored. */
function suggestedName(media: ToolMediaResponse): string {
  if (media.name) return media.name
  const tail = media.url.split('/').pop() ?? ''
  try {
    return decodeURIComponent(tail)
  } catch {
    return tail
  }
}

/** A file a tool returned, opened on its own: the picture in the image viewer
 *  (or a drawer for other files), and a way to keep it. The file lives on
 *  the machine that ran the tool, so saving is offered only where that machine
 *  is this one. */
export function MediaPreviewSheet({
  conversationId,
  media,
  name,
  images,
  onSelectMedia,
  onOpenChange,
}: {
  conversationId: string | null
  media: ToolMediaResponse
  name: string
  images?: readonly { media: ToolMediaResponse; name: string }[]
  onSelectMedia?: (media: ToolMediaResponse) => void
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const canSave = can.exportToDisk && conversationId !== null

  // Neither ImageViewer nor Drawer knows about the back gesture.
  useHistoryLevel(true, () => onOpenChange(false))

  React.useEffect(() => {
    setSaved(false)
    setSaveError(null)
  }, [media.url])

  const saveToDisk = React.useCallback(async () => {
    if (conversationId === null) return
    // Cancelling the picker rejects on Android instead of resolving to null.
    const path = await save({ defaultPath: suggestedName(media) }).catch(() => null)
    if (!path) return
    setSaveError(null)
    setSaving(true)
    try {
      await api.exportMediaFile({ conversationId, uri: media.url, outputPath: path })
      setSaved(true)
    } catch (error) {
      // Unsaid, a refused write looks exactly like a cancelled picker.
      setSaveError(String(error))
    } finally {
      setSaving(false)
    }
  }, [conversationId, media])

  if (media.kind === 'image') {
    const entries = images && images.length > 0 ? images : [{ media, name }]
    const viewerImages: ImageViewerImage[] = entries.map((entry) => ({
      id: entry.media.url,
      src: assetSrc(entry.media.url) ?? '',
      alt: entry.name,
      title: entry.name,
    }))
    return (
      <ImageViewer
        isOpen
        onOpenChange={onOpenChange}
        images={viewerImages}
        selectedKey={media.url}
        onSelectionChange={(key) => {
          const next = entries.find((entry) => entry.media.url === key)
          if (next) onSelectMedia?.(next.media)
        }}
        actions={() => (
          <div className="m-media-preview-sheet__viewer-actions">
            {saveError !== null && (
              <span role="alert" className="m-media-preview-sheet__error">
                {t('chat.media.saveFailed', { error: saveError })}
              </span>
            )}
            {canSave ? (
              <Button
                icon={<Download />}
                variant="secondary"
                size="sm"
                onPress={() => void saveToDisk()}
                isPending={saving}
              >
                {t(saved ? 'chat.media.saved' : 'chat.media.save')}
              </Button>
            ) : (
              <span className="m-media-preview-sheet__status">{t('capability.exportToDisk')}</span>
            )}
          </div>
        )}
      />
    )
  }

  return (
    <Drawer
      isOpen
      side="right"
      size="lg"
      onOpenChange={onOpenChange}
      isDismissable
      heading={<span className="m-media-preview-sheet__heading">{name}</span>}
      description={<span className="m-media-preview-sheet__mime">{media.mime_type}</span>}
      footer={
        <div className="m-media-preview-sheet__footer">
          <div data-slot="media-preview-status" className="m-media-preview-sheet__status">
            {!can.exportToDisk && t('capability.exportToDisk')}
            {saveError !== null && (
              <p role="alert" className="m-media-preview-sheet__error">
                {t('chat.media.saveFailed', { error: saveError })}
              </p>
            )}
          </div>
          {canSave && (
            <div data-slot="media-preview-actions" className="m-media-preview-sheet__actions">
              <Button icon={<Download />} variant="secondary" onPress={() => void saveToDisk()} isPending={saving}>
                {t(saved ? 'chat.media.saved' : 'chat.media.save')}
              </Button>
            </div>
          )}
        </div>
      }
    >
      <div data-slot="media-preview-none" className="m-media-preview-sheet__none">
        {t('chat.media.noPreview')}
      </div>
    </Drawer>
  )
}
