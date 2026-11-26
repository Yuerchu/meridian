import './studio-page.css'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { save } from '@tauri-apps/plugin-dialog'
import { Bin, Camera, Download, Image, Plus, RefreshCw, X, Zap } from '@keyline-icons/react/two-tone'
import { FileTrigger, TextArea as AriaTextArea, TextField as AriaTextField } from 'react-aria-components'

import { api } from '@/api'
import { SettingsSelect } from '@/components/settings/primitives'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { EmptyState } from '@/components/yuerchu-ui/components/empty-state/empty-state'
import { Label } from '@/components/yuerchu-ui/components/field/field'
import { Segment, SegmentedControl } from '@/components/yuerchu-ui/components/segmented-control/segmented-control'
import { Spinner } from '@/components/yuerchu-ui/components/spinner/spinner'
import { Switch } from '@/components/yuerchu-ui/components/switch/switch'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { assetSrc } from '@/lib/asset-src'
import { can } from '@/lib/capabilities'
import { listen } from '@/lib/transport'
import type {
  LogicalModelInfoResponse,
  MediaGenerationDomain,
  MediaGenerationInfoResponse,
  MediaReferenceImageRequest,
  MediaReferenceRole,
} from '@/types'

const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const
const IMAGE_QUALITIES = ['auto', 'low', 'medium', 'high'] as const
const VIDEO_RESOLUTIONS = ['480p', '720p', '1080p', '4k'] as const
const VIDEO_DURATIONS = [4, 5, 6, 8, 10] as const

interface StagedReference {
  id: string
  label: string
  previewUrl: string | null
  mimeType: string
  base64Data: string | null
  existingGenerationId: string | null
  existingAssetIndex: number | null
  role: MediaReferenceRole
}

function readFileAsBase64(file: File): Promise<{ mimeType: string; base64: string; previewUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '')
      const comma = dataUrl.indexOf(',')
      const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
      resolve({
        mimeType: file.type || 'image/png',
        base64,
        previewUrl: dataUrl,
      })
    }
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image'))
    reader.readAsDataURL(file)
  })
}

function extensionForMime(mime: string): string {
  switch (mime.toLowerCase()) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg'
    case 'image/webp':
      return 'webp'
    case 'video/webm':
      return 'webm'
    default:
      return mime.startsWith('video/') ? 'mp4' : 'png'
  }
}

export interface StudioPageProps {
  onOpenModelsSettings?: () => void
}

export function StudioPage({ onOpenModelsSettings }: StudioPageProps) {
  const { t } = useTranslation()
  const [domain, setDomain] = useState<MediaGenerationDomain>('image_gen')
  const [logicalModels, setLogicalModels] = useState<LogicalModelInfoResponse[]>([])
  const [defaultModelIds, setDefaultModelIds] = useState<{ image_gen: string | null; video_gen: string | null }>({
    image_gen: null,
    video_gen: null,
  })
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState<string>('16:9')
  const [quality, setQuality] = useState<string>('auto')
  const [count, setCount] = useState<string>('1')
  const [resolution, setResolution] = useState<string>('720p')
  const [durationSeconds, setDurationSeconds] = useState<string>('5')
  const [generateAudio, setGenerateAudio] = useState<boolean>(false)
  const [seed, setSeed] = useState<string>('')
  const [references, setReferences] = useState<StagedReference[]>([])
  const [generations, setGenerations] = useState<MediaGenerationInfoResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshGallery = useCallback(async () => {
    const items = await api.media.list({ capability_domain: null, limit: 60, offset: 0 })
    setGenerations(items)
  }, [])

  const loadInitial = useCallback(async () => {
    setLoading(true)
    try {
      setError(null)
      const [models, items, defaultImgPref, defaultVidPref] = await Promise.all([
        api.logicalModels.list(),
        api.media.list({ capability_domain: null, limit: 60, offset: 0 }),
        api.preferences.get({ key: 'media.default_image_model_id' }).catch(() => null),
        api.preferences.get({ key: 'media.default_video_model_id' }).catch(() => null),
      ])
      setLogicalModels(models)
      setGenerations(items)
      setDefaultModelIds({
        image_gen: defaultImgPref?.key === 'media.default_image_model_id' ? defaultImgPref.value : null,
        video_gen: defaultVidPref?.key === 'media.default_video_model_id' ? defaultVidPref.value : null,
      })
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadInitial()
  }, [loadInitial])

  useEffect(() => {
    let active = true
    let unlisten: (() => void) | null = null
    void listen('media-generation-updated', ({ payload }) => {
      if (!active) return
      setGenerations((prev) =>
        prev.map((item) =>
          item.id === payload.generation_id
            ? {
                ...item,
                status: payload.status,
                progress_pct: payload.progress_pct,
                error_message: payload.error_message,
              }
            : item,
        ),
      )
      if (payload.status === 'succeeded' || payload.status === 'failed' || payload.status === 'cancelled') {
        void refreshGallery().catch(() => {})
      }
    }).then((fn) => {
      if (active) unlisten = fn
      else fn()
    })
    return () => {
      active = false
      unlisten?.()
    }
  }, [refreshGallery])

  const domainModels = useMemo(
    () =>
      logicalModels.filter(
        (item) => item.profile.capability_domain === domain && item.deployments.some((d) => d.is_enabled),
      ),
    [logicalModels, domain],
  )

  useEffect(() => {
    if (domainModels.length === 0) {
      setSelectedModelId('')
      return
    }
    const stillValid = domainModels.some((m) => m.profile.id === selectedModelId)
    if (stillValid) return
    const preferred = defaultModelIds[domain]
    if (preferred && domainModels.some((m) => m.profile.id === preferred)) {
      setSelectedModelId(preferred)
    } else {
      setSelectedModelId(domainModels[0].profile.id)
    }
  }, [domainModels, domain, defaultModelIds, selectedModelId])

  const selectedModel = useMemo(
    () => domainModels.find((m) => m.profile.id === selectedModelId) ?? null,
    [domainModels, selectedModelId],
  )
  const enabledDeploymentCount = selectedModel ? selectedModel.deployments.filter((d) => d.is_enabled).length : 0

  const handleFilePicked = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const added: StagedReference[] = []
    for (const file of Array.from(files)) {
      const { mimeType, base64, previewUrl } = await readFileAsBase64(file)
      added.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        label: file.name,
        previewUrl,
        mimeType,
        base64Data: base64,
        existingGenerationId: null,
        existingAssetIndex: null,
        role: 'reference',
      })
    }
    setReferences((prev) => [...prev, ...added])
  }, [])

  const handleReuseFromGallery = useCallback((item: MediaGenerationInfoResponse, assetIndex: number) => {
    const asset = item.assets[assetIndex]
    if (!asset || !asset.mime_type.startsWith('image/')) return
    setReferences((prev) => [
      ...prev,
      {
        id: `reuse-${item.id}-${assetIndex}-${Date.now()}`,
        label: `${item.remote_model_id ?? 'original'} #${assetIndex + 1}`,
        previewUrl: assetSrc(asset.file_uri) ?? null,
        mimeType: asset.mime_type,
        base64Data: null,
        existingGenerationId: item.id,
        existingAssetIndex: assetIndex,
        role: 'reference',
      },
    ])
  }, [])

  const handleSubmit = useCallback(async () => {
    const trimmed = prompt.trim()
    if (!trimmed && references.length === 0) return
    setSubmitting(true)
    setError(null)
    try {
      const refPayload: MediaReferenceImageRequest[] = references.map((ref) => ({
        mime_type: ref.mimeType,
        base64_data: ref.base64Data,
        existing_generation_id: ref.existingGenerationId,
        existing_asset_index: ref.existingAssetIndex,
        role: ref.role,
      }))
      const parsedCount = Number.parseInt(count, 10)
      const parsedDuration = Number.parseInt(durationSeconds, 10)
      const parsedSeed = seed.trim() ? Number.parseInt(seed.trim(), 10) : null

      const created = await api.media.create({
        capability_domain: domain,
        logical_model_id: selectedModelId || null,
        prompt: trimmed,
        reference_images: refPayload,
        aspect_ratio: aspectRatio || null,
        size: null,
        quality: domain === 'image_gen' && quality !== 'auto' ? quality : null,
        count: domain === 'image_gen' && !Number.isNaN(parsedCount) ? parsedCount : null,
        resolution: domain === 'video_gen' ? resolution : null,
        duration_seconds: domain === 'video_gen' && !Number.isNaN(parsedDuration) ? parsedDuration : null,
        seed: parsedSeed !== null && !Number.isNaN(parsedSeed) ? parsedSeed : null,
        generate_audio: domain === 'video_gen' ? generateAudio : null,
        conversation_id: null,
      })
      setGenerations((prev) => [created, ...prev.filter((g) => g.id !== created.id)])
    } catch (err) {
      setError(String(err))
    } finally {
      setSubmitting(false)
    }
  }, [
    aspectRatio,
    count,
    domain,
    durationSeconds,
    generateAudio,
    prompt,
    quality,
    references,
    resolution,
    seed,
    selectedModelId,
  ])

  const handleCancel = useCallback(
    async (id: string) => {
      try {
        await api.media.cancel({ id })
        await refreshGallery()
      } catch (err) {
        setError(String(err))
      }
    },
    [refreshGallery],
  )

  const handleDelete = useCallback(async (id: string) => {
    try {
      await api.media.delete({ id })
      setGenerations((prev) => prev.filter((item) => item.id !== id))
    } catch (err) {
      setError(String(err))
    }
  }, [])

  const handleExport = useCallback(async (item: MediaGenerationInfoResponse, assetIndex: number) => {
    const asset = item.assets[assetIndex]
    if (!asset) return
    try {
      setError(null)
      const ext = extensionForMime(asset.mime_type)
      const defaultFileName = `meridian_${item.id.slice(0, 8)}_${assetIndex}.${ext}`
      if (can.browseForDirectory) {
        const dest = await save({ defaultPath: defaultFileName })
        if (!dest) return
        await api.media.export({ id: item.id, asset_index: assetIndex, destination_path: dest })
      } else {
        const exported = await api.media.export({ id: item.id, asset_index: assetIndex, destination_path: null })
        if (exported.base64_data) {
          const link = document.createElement('a')
          link.href = `data:${exported.mime_type};base64,${exported.base64_data}`
          link.download = defaultFileName
          link.click()
        }
      }
    } catch (err) {
      setError(String(err))
    }
  }, [])

  const visibleGenerations = useMemo(
    () => generations.filter((item) => item.capability_domain === domain),
    [generations, domain],
  )

  return (
    <div data-slot="studio-page" className="m-studio">
      <div className="m-studio__header">
        <div className="m-studio__title-group">
          <h2 className="m-studio__title">{t('studio.title')}</h2>
          <p className="m-studio__subtitle">{t('studio.subtitle')}</p>
        </div>
        <SegmentedControl
          aria-label={t('studio.modeLabel')}
          selectedKey={domain}
          onSelectionChange={(key) => setDomain(key as MediaGenerationDomain)}
        >
          <Segment id="image_gen">
            <Image aria-hidden size={14} /> {t('studio.mode.image')}
          </Segment>
          <Segment id="video_gen">
            <Camera aria-hidden size={14} /> {t('studio.mode.video')}
          </Segment>
        </SegmentedControl>
      </div>

      {error && (
        <Alert data-slot="studio-error" tone="danger" shouldAnnounce onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <div className="m-studio__workspace">
        <section data-slot="studio-composer" className="m-studio__composer">
          <div className="m-studio__field">
            {domainModels.length === 0 ? (
              <>
                <div className="m-studio__label">
                  <span>{t('studio.model')}</span>
                </div>
                <EmptyState
                  heading={t('studio.noModels')}
                  headingLevel={3}
                  description={t('studio.noModelsHint')}
                  size="sm"
                  actions={
                    onOpenModelsSettings ? (
                      <Button size="sm" variant="secondary" onPress={onOpenModelsSettings}>
                        {t('studio.configureModels')}
                      </Button>
                    ) : undefined
                  }
                />
              </>
            ) : (
              <>
                <div className="m-studio__label">
                  <span>{t('studio.model')}</span>
                  {enabledDeploymentCount > 1 && (
                    <span data-slot="studio-failover-badge" className="m-studio__badge">
                      <Zap aria-hidden size={12} />
                      {t('studio.statelessFailover', { count: enabledDeploymentCount })}
                    </span>
                  )}
                </div>
                <SettingsSelect
                  ariaLabel={t('studio.model')}
                  value={selectedModelId}
                  onChange={setSelectedModelId}
                  options={domainModels.map(({ profile, deployments }) => ({
                    value: profile.id,
                    label: `${profile.name} (${deployments.filter((d) => d.is_enabled).length})`,
                  }))}
                />
              </>
            )}
          </div>

          <AriaTextField className="m-studio__field" value={prompt} onChange={setPrompt}>
            <Label className="m-studio__label">{t('studio.prompt')}</Label>
            <AriaTextArea
              data-slot="studio-prompt"
              className="m-studio__prompt"
              placeholder={
                domain === 'image_gen' ? t('studio.imagePromptPlaceholder') : t('studio.videoPromptPlaceholder')
              }
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !submitting) {
                  e.preventDefault()
                  void handleSubmit()
                }
              }}
            />
          </AriaTextField>

          <div className="m-studio__params">
            <SettingsSelect
              label={t('studio.aspectRatio')}
              value={aspectRatio}
              onChange={setAspectRatio}
              options={ASPECT_RATIOS.map((ratio) => ({ value: ratio, label: ratio }))}
            />

            {domain === 'image_gen' ? (
              <>
                <SettingsSelect
                  label={t('studio.quality')}
                  value={quality}
                  onChange={setQuality}
                  options={IMAGE_QUALITIES.map((q) => ({ value: q, label: q }))}
                />
                <TextField label={t('studio.count')} name="studioCount" value={count} onChange={setCount} />
              </>
            ) : (
              <>
                <SettingsSelect
                  label={t('studio.resolution')}
                  value={resolution}
                  onChange={setResolution}
                  options={VIDEO_RESOLUTIONS.map((res) => ({ value: res, label: res }))}
                />
                <SettingsSelect
                  label={t('studio.duration')}
                  value={durationSeconds}
                  onChange={setDurationSeconds}
                  options={VIDEO_DURATIONS.map((sec) => ({ value: String(sec), label: `${sec}s` }))}
                />
              </>
            )}

            <TextField
              label={t('studio.seed')}
              name="studioSeed"
              placeholder={t('studio.seedPlaceholder')}
              value={seed}
              onChange={setSeed}
            />
          </div>

          {domain === 'video_gen' && (
            <Switch size="sm" isSelected={generateAudio} onChange={setGenerateAudio}>
              {t('studio.generateAudio')}
            </Switch>
          )}

          <div className="m-studio__refs">
            <div className="m-studio__label">
              <span>{t('studio.references')}</span>
              <FileTrigger
                acceptedFileTypes={['image/*']}
                allowsMultiple
                onSelect={(files) => {
                  void handleFilePicked(files)
                }}
              >
                <Button size="sm" variant="secondary" icon={<Plus />}>
                  {t('studio.addReference')}
                </Button>
              </FileTrigger>
            </div>
            {references.length > 0 && (
              <div className="m-studio__ref-list">
                {references.map((ref) => (
                  <div key={ref.id} data-slot="studio-reference-chip" className="m-studio__ref-chip">
                    {ref.previewUrl && <img src={ref.previewUrl} alt="" className="m-studio__ref-thumb" />}
                    <span>{ref.label}</span>
                    {domain === 'video_gen' && (
                      <SettingsSelect<MediaReferenceRole>
                        size="sm"
                        ariaLabel={t('studio.referenceRole')}
                        value={ref.role}
                        onChange={(role) =>
                          setReferences((prev) => prev.map((r) => (r.id === ref.id ? { ...r, role } : r)))
                        }
                        options={[
                          { value: 'reference', label: t('studio.role.reference') },
                          { value: 'first_frame', label: t('studio.role.firstFrame') },
                          { value: 'last_frame', label: t('studio.role.lastFrame') },
                        ]}
                      />
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<X />}
                      aria-label={t('common.delete')}
                      onPress={() => setReferences((prev) => prev.filter((r) => r.id !== ref.id))}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="m-studio__actions">
            <Button
              data-slot="studio-generate-btn"
              isPending={submitting}
              isDisabled={domainModels.length === 0 || (!prompt.trim() && references.length === 0)}
              onPress={() => void handleSubmit()}
            >
              {domain === 'image_gen' ? t('studio.generateImage') : t('studio.generateVideo')}
            </Button>
          </div>
        </section>

        <section data-slot="studio-gallery" className="m-studio__gallery">
          <div className="m-studio__label">
            <span>{t('studio.gallery')}</span>
            <Button size="sm" variant="ghost" icon={<RefreshCw />} onPress={() => void refreshGallery()}>
              {t('common.refresh')}
            </Button>
          </div>

          {loading ? (
            <div className="m-studio__progress">
              <Spinner />
            </div>
          ) : visibleGenerations.length === 0 ? (
            <EmptyState
              heading={t('studio.galleryEmpty')}
              headingLevel={3}
              description={t('studio.galleryEmptyHint')}
              size="sm"
            />
          ) : (
            <div className="m-studio__grid">
              {visibleGenerations.map((item) => {
                const firstAsset = item.assets[0] ?? null
                const isActive = item.status === 'queued' || item.status === 'running'
                return (
                  <article key={item.id} data-slot="studio-card" data-status={item.status} className="m-studio__card">
                    <div className="m-studio__media-frame">
                      {isActive ? (
                        <div className="m-studio__progress">
                          <Spinner />
                          <span>
                            {t(`studio.status.${item.status}`)}
                            {item.progress_pct !== null ? ` · ${item.progress_pct}%` : ''}
                          </span>
                        </div>
                      ) : firstAsset ? (
                        firstAsset.mime_type.startsWith('video/') ? (
                          <video src={assetSrc(firstAsset.file_uri)} controls className="m-studio__media-video" />
                        ) : (
                          <img src={assetSrc(firstAsset.file_uri)} alt={item.prompt} className="m-studio__media-img" />
                        )
                      ) : (
                        <div className="m-studio__progress">
                          <span>{item.error_message ?? t(`studio.status.${item.status}`)}</span>
                        </div>
                      )}
                    </div>

                    <p className="m-studio__card-prompt">{item.prompt}</p>
                    <div className="m-studio__card-meta">
                      <span>{item.remote_model_id ?? item.protocol_id ?? item.capability_domain}</span>
                      <span>{t(`studio.status.${item.status}`)}</span>
                    </div>

                    <div className="m-studio__card-actions">
                      {isActive && (
                        <Button size="sm" variant="secondary" onPress={() => void handleCancel(item.id)}>
                          {t('common.cancel')}
                        </Button>
                      )}
                      {firstAsset && firstAsset.mime_type.startsWith('image/') && (
                        <Button size="sm" variant="secondary" onPress={() => handleReuseFromGallery(item, 0)}>
                          {t('studio.useAsReference')}
                        </Button>
                      )}
                      {firstAsset && (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<Download />}
                          onPress={() => void handleExport(item, 0)}
                        >
                          {t('studio.export')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Bin />}
                        aria-label={t('common.delete')}
                        onPress={() => void handleDelete(item.id)}
                      />
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
