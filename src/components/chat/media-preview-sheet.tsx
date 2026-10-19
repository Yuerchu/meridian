import * as React from 'react'
import { Download } from '@keyline-icons/react/two-tone'
import { save } from '@tauri-apps/plugin-dialog'
import { useTranslation } from 'react-i18next'

import { api } from '@/api'
import { Button, Sheet } from '@/components/base'
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

/** A file a tool returned, opened on its own: the picture at full size, and a
 *  way to keep it. The file lives on the machine that ran the tool, so saving
 *  is offered only where that machine is this one. */
export function MediaPreviewSheet({
  conversationId,
  media,
  name,
  onOpenChange,
}: {
  conversationId: string | null
  media: ToolMediaResponse
  name: string
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const canSave = can.exportToDisk && conversationId !== null

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

  return (
    <Sheet isOpen placement="right" onOpenChange={onOpenChange} isDismissable>
      <Sheet.Backdrop>
        <Sheet.Content className="w-full sm:max-w-2xl">
          <Sheet.Dialog className="flex h-full min-h-0 flex-col">
            <Sheet.Header className="pe-14">
              <Sheet.Heading className="truncate">{name}</Sheet.Heading>
              <p className="mt-1 truncate font-mono text-caption-1-regular text-text-secondary">{media.mime_type}</p>
              <Sheet.CloseTrigger aria-label={t('common.close')} />
            </Sheet.Header>

            <Sheet.Body data-sheet-no-drag className="min-h-0 flex-1 overflow-auto p-0">
              {media.kind === 'image' ? (
                <div data-slot="media-preview-image" className="flex min-h-full items-center justify-center p-4">
                  <img src={assetSrc(media.url)} alt={name} className="block h-auto max-w-full object-contain" />
                </div>
              ) : (
                <div
                  data-slot="media-preview-none"
                  className="flex h-full items-center justify-center p-6 text-center text-body-regular text-text-secondary"
                >
                  {t('chat.media.noPreview')}
                </div>
              )}
            </Sheet.Body>

            <Sheet.Footer className="flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              <div
                data-slot="media-preview-status"
                className="min-w-0 flex-1 text-caption-1-regular text-text-secondary"
              >
                {!can.exportToDisk && t('capability.exportToDisk')}
                {saveError !== null && (
                  <p role="alert" className="text-status-danger wrap-break-word">
                    {t('chat.media.saveFailed', { error: saveError })}
                  </p>
                )}
              </div>
              {canSave && (
                <div data-slot="media-preview-actions" className="flex shrink-0 justify-end gap-2">
                  <Button
                    leadingIcon={Download}
                    variant="secondary"
                    onPress={() => void saveToDisk()}
                    isPending={saving}
                  >
                    {t(saved ? 'chat.media.saved' : 'chat.media.save')}
                  </Button>
                </div>
              )}
            </Sheet.Footer>
          </Sheet.Dialog>
        </Sheet.Content>
      </Sheet.Backdrop>
    </Sheet>
  )
}
