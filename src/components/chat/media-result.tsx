import './media-result.css'
import * as React from 'react'
import { Button as AriaButton } from 'react-aria-components'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'

import {
  AttachmentList,
  AttachmentPreview,
} from '@/components/yuerchu-ui/components/attachment-preview/attachment-preview'
import { Skeleton } from '@/components/yuerchu-ui/components/skeleton/skeleton'
import { useTranscriptConversationId } from '@/hooks/use-transcript-conversation'
import { assetSrc } from '@/lib/asset-src'
import type { ToolMediaResponse } from '@/types'
import { MediaPreviewSheet } from './media-preview-sheet'

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
      className="m-media-result__image-frame"
    >
      <img
        data-slot="media-image"
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="m-media-result__image"
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
      {!loaded && (
        <span data-slot="media-image-placeholder" className="m-media-result__placeholder" aria-hidden="true">
          <Skeleton shape="rect" width="100%" height="100%" />
        </span>
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

  const imageEntries = React.useMemo(
    () => media.filter((item) => item.kind === 'image').map((item) => ({ media: item, name: mediaName(t, item) })),
    [media, t],
  )

  if (media.length === 0) return null

  return (
    <>
      <div
        data-slot="media-result"
        role="group"
        aria-label={t('chat.media.label')}
        className={className ? `m-media-result ${className}` : 'm-media-result'}
      >
        <AttachmentList aria-label={t('chat.media.label')}>
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
                    className="m-media-result__image-button"
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
                    className="m-media-result__video"
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
                    className="m-media-result__audio"
                  />
                )
              case 'file':
                return (
                  <AriaButton
                    key={key}
                    data-slot="media-result-file"
                    aria-label={t('chat.media.open', { name })}
                    onPress={() => setOpened(item)}
                    className="m-media-result__file-button"
                  >
                    <AttachmentPreview name={name} />
                  </AriaButton>
                )
              default: {
                const exhaustive: never = item.kind
                return exhaustive
              }
            }
          })}
        </AttachmentList>
      </div>
      {opened && (
        <MediaPreviewSheet
          conversationId={conversationId}
          media={opened}
          name={mediaName(t, opened)}
          images={opened.kind === 'image' ? imageEntries : undefined}
          onSelectMedia={setOpened}
          onOpenChange={(open) => {
            if (!open) setOpened(null)
          }}
        />
      )}
    </>
  )
}
