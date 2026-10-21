import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button } from '@/components/base'
import { api } from '@/api'
import { isRemote } from '@/lib/transport'
import type { LocalInferenceBackend, LocalModelInfoResponse } from '@/types'
import { SETTINGS_ROW_SELECT_TRIGGER, SettingsRow, SettingsSelect } from '../primitives'

export function LocalModelSettings({
  providerId,
  modelPath,
  backend,
  onBackendChange,
}: {
  providerId: string
  modelPath: string
  backend: LocalInferenceBackend | null
  onBackendChange: (value: LocalInferenceBackend) => void
}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const formatter = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const [info, setInfo] = useState<LocalModelInfoResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const serial = useRef(0)
  useEffect(
    () => () => {
      serial.current += 1
    },
    [],
  )
  const options: Array<{ value: LocalInferenceBackend; label: string }> = [
    { value: 'auto', label: t('settings.localModel.auto') },
    { value: 'cpu', label: 'CPU' },
    { value: 'gpu', label: 'GPU' },
    { value: 'npu', label: 'NPU' },
  ]
  const number = (value: number | null) =>
    value === null ? t('settings.localModel.unavailable') : formatter.format(value)
  const list = (value: number[] | null) =>
    value === null ? t('settings.localModel.unavailable') : value.map(number).join(', ')
  const inspect = async () => {
    if (backend === null) return
    const request = ++serial.current
    setChecking(true)
    setError(null)
    try {
      const next = isRemote
        ? await api.getProviderLocalModelInfo({ providerId, forceRefresh: true })
        : await api.inspectLocalModel({ modelPath, backend, forceRefresh: true })
      if (request === serial.current) setInfo(next)
    } catch (reason) {
      if (request === serial.current) {
        setError(String(reason))
      }
    } finally {
      if (request === serial.current) setChecking(false)
    }
  }
  return (
    <>
      <SettingsRow
        stacked
        className="@sm/pane:flex-col @sm/pane:items-stretch"
        label={t('settings.localModel.backend')}
        description={t('settings.localModel.backendHint')}
      >
        {({ labelId }) =>
          backend === null ? (
            <p className="text-body-regular text-status-danger">{t('settings.localModel.missingBackend')}</p>
          ) : (
            <SettingsSelect
              ariaLabelledBy={labelId}
              value={backend}
              options={options}
              onChange={onBackendChange}
              triggerClassName={SETTINGS_ROW_SELECT_TRIGGER}
              disabled={isRemote}
            />
          )
        }
      </SettingsRow>
      {isRemote && <SettingsRow label={t('settings.localModel.hostOnly')} />}
      <SettingsRow
        label={t('settings.localModel.metadata')}
        description={t('settings.localModel.metadataHint')}
        stacked
      >
        <Button
          size="small"
          variant="secondary"
          onPress={inspect}
          isPending={checking}
          isDisabled={backend === null || (!isRemote && (modelPath === '' || modelPath === 'local://'))}
        >
          {t(info === null ? 'settings.localModel.inspect' : 'settings.localModel.inspectAgain')}
        </Button>
        {error !== null && (
          <Alert status="danger" role="alert">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{t('settings.localModel.inspectError')}</Alert.Title>
              <Alert.Description className="break-all">{error}</Alert.Description>
            </Alert.Content>
          </Alert>
        )}
      </SettingsRow>
      {info !== null && error === null && (
        <>
          <SettingsRow
            stacked
            label={t('settings.localModel.fileAlias')}
            description={t('settings.localModel.fileAliasHint')}
            className="@sm/pane:flex-col @sm/pane:items-stretch"
          >
            <p className="break-all text-body-regular text-text-secondary">{info.file_name}</p>
          </SettingsRow>
          <SettingsRow stacked label={t('settings.localModel.identity')}>
            <p className="text-body-regular text-text-secondary">{t('settings.localModel.unavailable')}</p>
          </SettingsRow>
          <SettingsRow label={t('settings.localModel.runtime')}>
            <p className="text-body-regular text-text-secondary">{info.runtime_version}</p>
          </SettingsRow>
          <SettingsRow stacked label={t('settings.localModel.kind')}>
            <p className="text-body-regular text-text-secondary">{t(`settings.localModel.kind.${info.kind}`)}</p>
          </SettingsRow>
          <SettingsRow label={t('settings.localModel.fileSize')}>
            <p className="text-body-regular text-text-secondary">
              {t('settings.localModel.bytes', { count: info.file_size_bytes })}
            </p>
          </SettingsRow>
          <SettingsRow label={t('settings.localModel.resolved')} description={t('settings.localModel.notInitialized')}>
            <p className="text-body-regular text-text-secondary">
              {info.resolved_backend === null
                ? t('settings.localModel.unavailable')
                : info.resolved_backend.toUpperCase()}
            </p>
          </SettingsRow>
          {info.modalities.map((item) => (
            <SettingsRow key={item.modality} label={t(`settings.localModel.modality.${item.modality}`)} stacked>
              <p className="text-body-regular text-text-secondary">
                {item.preferred_backends.map((value) => value.toUpperCase()).join(', ')}
              </p>
              {item.preferred_backends.includes('npu') && (
                <p className="text-caption-1-regular text-text-secondary">
                  {t('settings.localModel.npuTarget', {
                    brand:
                      item.npu_brand === null
                        ? t('settings.localModel.unavailable')
                        : t(`settings.localModel.brand.${item.npu_brand}`),
                    soc: item.soc_name ?? t('settings.localModel.unavailable'),
                  })}
                </p>
              )}
            </SettingsRow>
          ))}
          <SettingsRow label={t('settings.localModel.context')} description={t('settings.localModel.contextHint')}>
            <p className="text-body-regular text-text-secondary">{number(info.max_context_tokens)}</p>
          </SettingsRow>
          <SettingsRow stacked label={t('settings.localModel.contextMode')}>
            <p className="text-body-regular text-text-secondary">
              {t(
                info.max_context_tokens === null
                  ? 'settings.localModel.unavailable'
                  : info.is_dynamic_context
                    ? 'settings.localModel.dynamic'
                    : 'settings.localModel.static',
              )}
            </p>
          </SettingsRow>
          <SettingsRow stacked label={t('settings.localModel.thinking')}>
            <p className="text-body-regular text-text-secondary">
              {t(info.supports_thinking ? 'settings.localModel.declared' : 'settings.localModel.notDeclared')}
            </p>
          </SettingsRow>
          <SettingsRow stacked label={t('settings.localModel.tools')}>
            <p className="text-body-regular text-text-secondary">
              {t(info.supports_function_calling ? 'settings.localModel.declared' : 'settings.localModel.notDeclared')}
            </p>
          </SettingsRow>
          <SettingsRow stacked label={t('settings.localModel.speculative')}>
            <p className="text-body-regular text-text-secondary">
              {t(
                info.supports_speculative_decoding ? 'settings.localModel.declared' : 'settings.localModel.notDeclared',
              )}
            </p>
          </SettingsRow>
          <SettingsRow stacked label={t('settings.localModel.sampler')}>
            <p className="text-body-regular text-text-secondary">
              {info.sampler_defaults === null
                ? t('settings.localModel.unavailable')
                : t('settings.localModel.samplerValues', {
                    type: info.sampler_defaults.sampler_type,
                    temperature: number(info.sampler_defaults.temperature),
                    topK: number(info.sampler_defaults.top_k),
                    topP: number(info.sampler_defaults.top_p),
                  })}
            </p>
          </SettingsRow>
          <SettingsRow label={t('settings.localModel.visionBudget')}>
            <p className="text-body-regular text-text-secondary">{number(info.max_vision_token_budget)}</p>
          </SettingsRow>
          <SettingsRow label={t('settings.localModel.visionSignatures')}>
            <p className="break-all text-body-regular text-text-secondary">{list(info.vision_signature_lengths)}</p>
          </SettingsRow>
          <SettingsRow label={t('settings.localModel.embeddingDimension')}>
            <p className="text-body-regular text-text-secondary">{number(info.embedding_dimension)}</p>
          </SettingsRow>
          <SettingsRow label={t('settings.localModel.embeddingSignatures')}>
            <p className="break-all text-body-regular text-text-secondary">{list(info.embedding_signature_lengths)}</p>
          </SettingsRow>
          <SettingsRow label={t('settings.localModel.minimumVersion')}>
            <p className="text-body-regular text-text-secondary">
              {info.min_runtime_version ?? t('settings.localModel.unavailable')}
            </p>
          </SettingsRow>
        </>
      )}
    </>
  )
}
