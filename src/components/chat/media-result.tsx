import * as React from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'

import { ChatAttachment, ChatAttachmentGroup, Skeleton } from '@/components/base'
import { useTranscriptConversationId } from '@/hooks/use-transcript-conversation'
import { assetSrc } from '@/lib/asset-src'
import type { ToolMediaResponse } from '@/types'
import { cx } from '@/utils/cx'
import { MediaPreviewSheet } from './media-preview-sheet'

const FOCUS_RING = 'outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring'

function mediaName(t: TFunction, media: ToolMediaResponse): string {
  return media.name ?? t(`chat.media.untitled.${media.kind}`)
}

/** A picture in the card, the shape of a picture until it arrives. */
function MediaImage({ src, alt }: { src: string | undefined; alt: string }) {
  const { t } = useTranslation()
  const [loaded, setLoaded] = React.useState(false)

  return (
    <span
      data-slot="media-image-frame"
      data-loaded={loaded || undefined}
      role={loaded ? undefined : 'status'}
      aria-busy={loaded ? undefined : true}
      aria-label={loaded ? undefined : t('common.loading')}
      className={cx(
        'relative block w-fit max-w-full overflow-hidden rounded-lg bg-background-secondary-default/20',
        !loaded && 'min-h-24 min-w-24',
      )}
    >
      <img
        data-slot="media-image"
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={cx(
          'block h-auto max-h-64 max-w-full object-contain transition-opacity motion-reduce:transition-none',
          !loaded && 'opacity-0',
        )}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
      {!loaded && (
        <Skeleton
          aria-hidden="true"
          className="absolute inset-0"
          render={(props) => <span data-slot="media-image-placeholder" {...(props as React.ComponentProps<'span'>)} />}
        />
      )}
    </span>
  )
}

/**
 * The files a tool returned beside its text, drawn under its result: pictures
 * as pictures, video and audio with the WebView's own controls, anything else
 * as a chip. A picture or a file opens on its own sheet, which is where it can
 * be saved.
 */
export function MediaResult({ media, className }: { media: ToolMediaResponse[]; className?: string }) {
  const { t } = useTranslation()
  const conversationId = useTranscriptConversationId()
  const [opened, setOpened] = React.useState<ToolMediaResponse | null>(null)

  if (media.length === 0) return null

  return (
    <>
      <ChatAttachmentGroup
        data-slot="media-result"
        role="group"
        aria-label={t('chat.media.label')}
        className={cx('items-start px-3 py-2', className)}
      >
        {media.map((item, index) => {
          const name = mediaName(t, item)
          const key = `${index}:${item.url}`
          switch (item.kind) {
            case 'image':
              return (
                <AriaButton
                  key={key}
                  data-slot="media-result-image"
                  aria-label={t('chat.media.open', { name })}
                  onPress={() => setOpened(item)}
                  className={cx('max-w-full cursor-zoom-in rounded-lg', FOCUS_RING)}
                >
                  <MediaImage src={assetSrc(item.url)} alt={name} />
                </AriaButton>
              )
            case 'video':
              return (
                <video
                  key={key}
                  data-slot="media-result-video"
                  aria-label={name}
                  src={assetSrc(item.url)}
                  controls
                  playsInline
                  preload="metadata"
                  className="block max-h-80 max-w-full rounded-lg bg-background-secondary-default"
                />
              )
            case 'audio':
              return (
                <audio
                  key={key}
                  data-slot="media-result-audio"
                  aria-label={name}
                  src={assetSrc(item.url)}
                  controls
                  preload="metadata"
                  className="block max-w-full"
                />
              )
            case 'file':
              return (
                <AriaButton
                  key={key}
                  data-slot="media-result-file"
                  aria-label={t('chat.media.open', { name })}
                  onPress={() => setOpened(item)}
                  className={cx('max-w-64 rounded-xl text-start', FOCUS_RING)}
                >
                  <ChatAttachment name={name}>
                    <ChatAttachment.Preview />
                    <ChatAttachment.Info>
                      <span className="block truncate text-body-2-medium text-text-primary">{name}</span>
                      <span className="block truncate font-mono text-caption-1-regular text-text-secondary">
                        {item.mime_type}
                      </span>
                    </ChatAttachment.Info>
                  </ChatAttachment>
                </AriaButton>
              )
            default: {
              const exhaustive: never = item.kind
              return exhaustive
            }
          }
        })}
      </ChatAttachmentGroup>
      {opened && (
        <MediaPreviewSheet
          conversationId={conversationId}
          media={opened}
          name={mediaName(t, opened)}
          onOpenChange={(open) => {
            if (!open) setOpened(null)
          }}
        />
      )}
    </>
  )
}
