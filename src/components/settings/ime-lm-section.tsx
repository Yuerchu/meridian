import { Fragment, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
import {
  Alert,
  Button,
  Chip,
  ItemCard,
  ItemCardGroup,
  Separator,
  Spinner,
  Tooltip,
  TooltipTrigger,
} from '@/components/base'
import { Bin } from '@keyline-icons/react/two-tone'

import { api } from '@/api'
import { can } from '@/lib/capabilities'
import { useConfirm } from '@/hooks/use-confirm'
import type { ImeLmBundleInfoResponse, ImeLmStatusInfoResponse } from '@/types'

/**
 * The input method's local language model and the memory hints it may read.
 *
 * Both are files the host watches, so nothing here talks to the host: a
 * bundle installed or removed is picked up within a second, and the hints
 * file is rewritten every minute anyway — the button only saves the wait.
 */
export function ImeLmSection() {
  const { t } = useTranslation()
  const { confirm, confirmDialog } = useConfirm()
  const [status, setStatus] = useState<ImeLmStatusInfoResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [hints, setHints] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      setStatus(await api.getImeLmStatus())
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
      setStatus(await api.importImeLm({ path: dir }))
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (bundle: ImeLmBundleInfoResponse) => {
    const name = bundle.id ?? bundle.dir_name
    if (!(await confirm({ body: t('settings.ime.lm.removeConfirm', { name }), status: 'danger' }))) return
    setError(null)
    try {
      setStatus(await api.removeImeLm({ dir_name: bundle.dir_name }))
    } catch (err) {
      setError(String(err))
    }
  }

  const handleRefreshHints = async () => {
    setError(null)
    try {
      setHints((await api.refreshImeMemoryHints()).count)
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <div data-slot="ime-lm" className="space-y-1.5">
      <div data-slot="ime-lm-head" className="flex items-center justify-between gap-3">
        <p data-slot="ime-lm-label" className="text-caption-1-medium text-text-secondary">
          {t('settings.ime.lm.title')}
        </p>
        {can.importFromDisk && (
          <Button size="small" variant="secondary" onPress={handleImport} isDisabled={busy} isPending={busy}>
            {t('settings.ime.lm.import')}
          </Button>
        )}
      </div>

      {status === null && !error && (
        <p data-slot="ime-lm-loading" role="status" className="flex items-center gap-2">
          <Spinner size="sm" />
        </p>
      )}

      {status && !status.runtime_found && status.bundles.length > 0 && (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{t('settings.ime.lm.noRuntime')}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      {status &&
        (status.bundles.length === 0 ? (
          <p data-slot="ime-lm-empty" className="text-caption-1-regular text-text-secondary">
            {t('settings.ime.lm.empty')}
          </p>
        ) : (
          <ItemCardGroup variant="outline">
            {status.bundles.map((bundle, index) => {
              const name = bundle.id ?? bundle.dir_name
              return (
                <Fragment key={bundle.dir_name}>
                  {index > 0 && <Separator />}
                  <ItemCard>
                    <ItemCard.Content className="min-w-0">
                      <ItemCard.Title className="flex w-full items-center gap-2">
                        <span data-slot="ime-lm-name" className="truncate">
                          {name}
                        </span>
                        {status.active === bundle.dir_name && (
                          <Chip size="sm" color="success" variant="soft">
                            {t('settings.ime.lm.active')}
                          </Chip>
                        )}
                        {bundle.personal && (
                          <Chip size="sm" variant="soft">
                            {t('settings.ime.lm.personal')}
                          </Chip>
                        )}
                      </ItemCard.Title>
                      <ItemCard.Description className="w-full whitespace-normal break-all">
                        {bundle.error
                          ? t('settings.ime.lm.broken', { error: bundle.error })
                          : t('settings.ime.lm.detail', { version: bundle.version, license: bundle.license })}
                      </ItemCard.Description>
                    </ItemCard.Content>
                    <ItemCard.Action>
                      <TooltipTrigger delay={0}>
                        <Button
                          iconOnly
                          leadingIcon={Bin}
                          size="small"
                          variant="neutral"
                          aria-label={t('settings.ime.lm.remove', { name })}
                          onPress={() => handleRemove(bundle)}
                        />
                        <Tooltip>{t('settings.ime.lm.remove', { name })}</Tooltip>
                      </TooltipTrigger>
                    </ItemCard.Action>
                  </ItemCard>
                </Fragment>
              )
            })}
          </ItemCardGroup>
        ))}

      <p data-slot="ime-lm-hint" className="text-caption-1-regular text-text-secondary">
        {t('settings.ime.lm.hint')}
      </p>

      <div data-slot="ime-hints" className="flex items-center gap-3 pt-1">
        <Button size="small" variant="secondary" onPress={handleRefreshHints}>
          {t('settings.ime.hints.refresh')}
        </Button>
        {hints !== null && (
          <span data-slot="ime-hints-done" role="status" className="text-caption-1-regular text-text-secondary">
            {t('settings.ime.hints.done', { count: hints })}
          </span>
        )}
      </div>
      <p data-slot="ime-hints-hint" className="text-caption-1-regular text-text-secondary">
        {t('settings.ime.hints.hint')}
      </p>

      {error && (
        <p data-slot="ime-lm-error" role="alert" className="text-caption-1-regular text-status-danger break-all">
          {error}
        </p>
      )}
      {confirmDialog}
    </div>
  )
}
