import './ime-lm-section.css'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
import { Spinner } from '@/components/yuerchu-ui/components/spinner/spinner'
import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { SettingsGroup, SettingsRow } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Bin } from '@keyline-icons/react/two-tone'

import { api } from '@/api'
import { can } from '@/lib/capabilities'
import { useConfirm } from '@/hooks/use-confirm'
import type { ImeLmBundleInfoResponse, ImeLmStatusInfoResponse } from '@/types'
import { titleIfTruncated } from '@/lib/truncation'

/**
 * The input method's local language model and the memory hints it may read.
 *
 * Both are files the host watches, so nothing here talks to the host: a
 * bundle installed or removed is picked up within a second, and the hints
 * file is rewritten every minute anyway — the button only saves the wait.
 */
export function ImeLmSection({ canImport }: { canImport: boolean }) {
  const { t } = useTranslation()
  const { confirm, confirmDialog } = useConfirm()
  const [status, setStatus] = useState<ImeLmStatusInfoResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [hints, setHints] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      setStatus(await api.ime.getLmStatus())
    } catch (err) {
      setError(String(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleImport = async () => {
    setError(null)
    const dir = await open({ multiple: false, directory: true })
    if (!dir) return
    setBusy(true)
    try {
      setStatus(await api.ime.importLm({ path: dir }))
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (bundle: ImeLmBundleInfoResponse) => {
    const name = bundle.id ?? bundle.dir_name
    if (
      !(await confirm({
        description: t('settings.ime.lm.removeConfirm', { name }),
        tone: 'danger',
        confirmLabel: t('common.delete'),
      }))
    )
      return
    setError(null)
    try {
      setStatus(await api.ime.deleteLm({ dir_name: bundle.dir_name }))
    } catch (err) {
      setError(String(err))
    }
  }

  const handleRefreshHints = async () => {
    setError(null)
    try {
      setHints((await api.ime.refreshMemoryHints()).count)
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <div data-slot="ime-lm" className="m-ime-lm">
      <div data-slot="ime-lm-head" className="m-ime-lm__head">
        <p data-slot="ime-lm-label" className="m-ime-lm__label">
          {t('settings.ime.lm.title')}
        </p>
        {can.importFromDisk && canImport && (
          <Button size="sm" variant="secondary" onPress={handleImport} isDisabled={busy} isPending={busy}>
            {t('settings.ime.lm.import')}
          </Button>
        )}
      </div>

      {status === null && !error && (
        <div data-slot="ime-lm-loading">
          <Spinner size="sm" aria-label={t('common.loading')} />
        </div>
      )}

      {status && !status.runtime_found && status.bundles.length > 0 && (
        <Alert tone="warning">{t('settings.ime.lm.noRuntime')}</Alert>
      )}

      {status &&
        (status.bundles.length === 0 ? (
          <p data-slot="ime-lm-empty" className="m-ime-lm__hint">
            {t('settings.ime.lm.empty')}
          </p>
        ) : (
          <SettingsGroup>
            {status.bundles.map((bundle) => {
              const name = bundle.id ?? bundle.dir_name
              return (
                <SettingsRow
                  key={bundle.dir_name}
                  label={
                    <span className="m-ime-lm__title">
                      <span data-slot="ime-lm-name" onPointerEnter={titleIfTruncated} className="m-ime-lm__name">
                        {name}
                      </span>
                      {status.active === bundle.dir_name && (
                        <Badge size="sm" tone="success">
                          {t('settings.ime.lm.active')}
                        </Badge>
                      )}
                      {bundle.personal && <Badge size="sm">{t('settings.ime.lm.personal')}</Badge>}
                    </span>
                  }
                  description={
                    <span className="m-ime-lm__detail">
                      {bundle.error
                        ? t('settings.ime.lm.broken', { error: bundle.error })
                        : t('settings.ime.lm.detail', { version: bundle.version, license: bundle.license })}
                    </span>
                  }
                >
                  <TooltipTrigger>
                    <Button
                      icon={<Bin />}
                      size="sm"
                      variant="ghost"
                      aria-label={t('settings.ime.lm.remove', { name })}
                      onPress={() => handleRemove(bundle)}
                    />
                    <Tooltip>{t('settings.ime.lm.remove', { name })}</Tooltip>
                  </TooltipTrigger>
                </SettingsRow>
              )
            })}
          </SettingsGroup>
        ))}

      <p data-slot="ime-lm-hint" className="m-ime-lm__hint">
        {t('settings.ime.lm.hint')}
      </p>

      <div data-slot="ime-hints" className="m-ime-lm__hints">
        <Button size="sm" variant="secondary" onPress={handleRefreshHints}>
          {t('settings.ime.hints.refresh')}
        </Button>
        {hints !== null && (
          <span data-slot="ime-hints-done" role="status" className="m-ime-lm__hint">
            {t('settings.ime.hints.done', { count: hints })}
          </span>
        )}
      </div>
      <p data-slot="ime-hints-hint" className="m-ime-lm__hint">
        {t('settings.ime.hints.hint')}
      </p>

      {error && (
        <Alert data-slot="ime-lm-error" tone="danger" shouldAnnounce>
          {error}
        </Alert>
      )}
      {confirmDialog}
    </div>
  )
}
