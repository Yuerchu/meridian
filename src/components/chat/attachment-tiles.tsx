import './attachment-tiles.css'
import { useEffect, useState, type Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'motion/react'
import { Button as AriaButton, GridList, GridListItem, useDragAndDrop, type Key } from 'react-aria-components'
import { File as FileGlyph, X } from '@keyline-icons/react/two-tone'

import { Button } from '@/components/yuerchu-ui/components/button/button'
import { useAttachmentPreview } from '@/hooks/use-attachment-preview'
import { fileIconUrl } from '@/lib/file-icon'
import { objectKey } from '@/lib/object-key'
import type { Attachment } from '@/lib/upload'

/**
 * The drag type a tile carries. Its own, and never `text/plain`: a tile let go
 * over the field would otherwise paste its key into the message, and the
 * window's conversation drop zone accepts only what it recognises.
 */
export const ATTACHMENT_DRAG_TYPE = 'application/x-meridian-attachment'

/** BoardUI's entrance: 400ms ease-out, from 95% and a 2px blur. */
const ENTER = { duration: 0.4, ease: [0, 0, 0.2, 1] as const }
/** The calmer of motion.md's two layout springs, for tiles closing a gap. */
const SETTLE = { type: 'spring' as const, stiffness: 260, damping: 30 }

/** What a dragged tile carries: its key, under its own type and nothing else. */
export function attachmentDragItems(keys: Set<Key>): Record<string, string>[] {
  return [...keys].map((key) => ({ [ATTACHMENT_DRAG_TYPE]: String(key) }))
}

/** `files` reordered so that `keys` sit before or after `target`. */
export function reorderAttachments(
  files: Attachment[],
  keys: Set<Key>,
  target: Key,
  position: 'before' | 'after' | 'on',
): Attachment[] {
  const picked = files.filter((file) => keys.has(objectKey(file)))
  const rest = files.filter((file) => !keys.has(objectKey(file)))
  const at = rest.findIndex((file) => objectKey(file) === target)
  if (at < 0) return files
  const insert = position === 'after' ? at + 1 : at
  return [...rest.slice(0, insert), ...picked, ...rest.slice(insert)]
}

/**
 * What the next message carries, as tiles in the order they will be sent.
 *
 * A tile shows the file the way it will arrive — a picture as itself, anything
 * else as its type and name — so what is about to go out can be checked at a
 * glance. With two or more, each is numbered and can be moved: the order is
 * the order the model receives them in, which is what lets a prompt say "the
 * second file". The number is the keyboard's handle for moving it.
 *
 * One row that scrolls sideways, never wrapping: wrapped, ten files on a phone
 * stacked into rows and pushed the composer up into the transcript.
 */
export function AttachmentTiles({
  files,
  onRemove,
  onReorder,
  ref,
}: {
  files: Attachment[]
  onRemove?: (index: number) => void
  onReorder?: (next: Attachment[]) => void
  ref?: Ref<HTMLDivElement>
}) {
  const { t } = useTranslation()
  const movable = !!onReorder && files.length > 1
  const { dragAndDropHooks } = useDragAndDrop({
    isDisabled: !movable,
    getItems: attachmentDragItems,
    acceptedDragTypes: [ATTACHMENT_DRAG_TYPE],
    onReorder: (event) => {
      if (event.target.dropPosition === 'on') return
      onReorder?.(reorderAttachments(files, event.keys, event.target.key, event.target.dropPosition))
    },
    renderDropIndicator: (target) => (
      <div data-slot="attachment-drop-indicator" className="m-attachment-tiles__drop-indicator">
        <span className="m-attachment-tiles__sr-only">{target.type === 'item' ? target.dropPosition : ''}</span>
      </div>
    ),
  })

  return (
    <GridList
      ref={ref}
      data-slot="attachment-tiles"
      aria-label={t('chat.attachments.label')}
      layout="grid"
      selectionMode="none"
      dragAndDropHooks={dragAndDropHooks}
      className="m-attachment-tiles"
    >
      {files.map((file, index) => (
        <AttachmentTile
          key={objectKey(file)}
          file={file}
          index={index}
          numbered={files.length > 1}
          movable={movable}
          onRemove={onRemove ? () => onRemove(index) : undefined}
        />
      ))}
    </GridList>
  )
}

function AttachmentTile({
  file,
  index,
  numbered,
  movable,
  onRemove,
}: {
  file: Attachment
  index: number
  numbered: boolean
  movable: boolean
  onRemove?: () => void
}) {
  const { t } = useTranslation()
  const preview = useAttachmentPreview(file)
  const [broken, setBroken] = useState(false)
  useEffect(() => {
    setBroken(false)
  }, [preview])
  const src = preview !== null && !broken ? preview : null
  const icon = src === null ? fileIconUrl(file.name) : null
  const position = t('chat.attachments.position', { index: index + 1, name: file.name })
  return (
    <GridListItem
      id={objectKey(file)}
      textValue={position}
      data-slot="attachment-tile"
      className="m-attachment-tiles__tile"
    >
      {/* `layout="position"`: a tile slides into the gap another left, or to
          where a reorder put it, and never stretches. The global MotionConfig
          (`reducedMotion="user"`) turns the slide and the scale off under
          reduced motion and leaves the fade. */}
      <motion.div
        layout="position"
        initial={{ opacity: 0, scale: 0.95, filter: 'blur(2px)' }}
        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
        transition={{ ...ENTER, layout: SETTLE }}
        title={file.missing ? `${file.name} — ${t('chat.draft.fileMissing')}` : file.name}
        data-missing={file.missing || undefined}
        className="m-attachment-tiles__card"
      >
        {src !== null ? (
          <img
            data-slot="attachment-tile-preview"
            src={src}
            alt=""
            className="m-attachment-tiles__preview"
            onError={() => setBroken(true)}
          />
        ) : (
          <>
            <span data-slot="attachment-tile-icon" className="m-attachment-tiles__icon">
              {icon ? (
                <img src={icon} alt="" aria-hidden className="m-attachment-tiles__glyph" />
              ) : (
                <FileGlyph aria-hidden className="m-attachment-tiles__glyph" />
              )}
            </span>
            <span
              data-slot="attachment-tile-name"
              data-missing={file.missing || undefined}
              className="m-attachment-tiles__name"
            >
              {file.name}
            </span>
          </>
        )}
        {numbered &&
          (movable ? (
            <AriaButton
              slot="drag"
              aria-label={t('chat.attachments.reorder', { name: file.name })}
              data-slot="attachment-tile-order"
              className="m-attachment-tiles__order"
            >
              {index + 1}
            </AriaButton>
          ) : (
            <span aria-hidden data-slot="attachment-tile-order" className="m-attachment-tiles__order">
              {index + 1}
            </span>
          ))}
        {onRemove && (
          <span data-slot="attachment-tile-remove" className="m-attachment-tiles__remove">
            <Button
              icon={<X />}
              variant="secondary"
              size="sm"
              aria-label={t('chat.removeAttachment', { name: file.name })}
              onPress={onRemove}
            />
          </span>
        )}
      </motion.div>
    </GridListItem>
  )
}
