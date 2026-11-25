import './android-file-access.css'
import { Switch } from '@/components/yuerchu-ui/components/switch/switch'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, X } from '@keyline-icons/react/two-tone'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'

import { EmptyState } from '@/components/yuerchu-ui/components/empty-state/empty-state'
import { api } from '@/api'
import type { SafRootListResponse } from '@/types'
import { titleIfTruncated } from '@/lib/truncation'

/**
 * Android-only settings block: SAF directory grants + the
 * MANAGE_EXTERNAL_STORAGE ("All files access") opt-in switch.
 */
export function AndroidFileAccess() {
  const { t } = useTranslation()
  const [manageEnabled, setManageEnabled] = useState(false)
  const [manageGranted, setManageGranted] = useState(false)
  const [safRoots, setSafRoots] = useState<SafRootListResponse>([])
  const [picking, setPicking] = useState(false)
  // Every failure here used to go to the console, which on a phone is nowhere:
  // a directory that did not get added looked like a picker that did nothing.
  const [error, setError] = useState<string | null>(null)
  const report = useCallback((e: unknown) => setError(String(e)), [])

  const refreshGranted = useCallback(() => {
    api.platform.getManageStorageStatus().then(setManageGranted).catch(report)
  }, [report])

  useEffect(() => {
    api.preferences
      .get({ key: 'android.manage_storage_enabled' })
      .then(({ value }) => setManageEnabled(value ?? false))
      .catch(report)
    api.platform.listSafRoots().then(setSafRoots).catch(report)
    refreshGranted()
    // Re-check the system grant when returning from the system settings page.
    // On Android WebView, window 'focus' may not fire reliably on Activity
    // resume; visibilitychange is more dependable.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshGranted()
    }
    const onFocus = () => refreshGranted()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [refreshGranted, report])

  const handleManageToggle = async (checked: boolean) => {
    setError(null)
    setManageEnabled(checked)
    try {
      await api.preferences.set({ key: 'android.manage_storage_enabled', value: checked })
    } catch (e) {
      // Not written, so the switch goes back to what is actually stored.
      setManageEnabled(!checked)
      report(e)
      return
    }
    if (checked && !manageGranted) {
      try {
        await api.platform.openManageStorageSettings()
      } catch (e) {
        report(e)
      }
    }
  }

  const handleAddDirectory = async () => {
    setError(null)
    setPicking(true)
    try {
      setSafRoots(await api.platform.selectSafDirectory())
    } catch (e) {
      report(e)
    } finally {
      setPicking(false)
    }
  }

  const handleRemove = async (uri: string) => {
    setError(null)
    try {
      setSafRoots(await api.platform.deleteSafRoot({ uri }))
    } catch (e) {
      report(e)
    }
  }

  return (
    <div data-slot="android-file-access" className="m-file-access">
      <div data-slot="file-access-heading">
        <h3 data-slot="file-access-title" className="m-file-access__title">
          {t('settings.fileAccess.title')}
        </h3>
        <p data-slot="file-access-description" className="m-file-access__hint">
          {t('settings.fileAccess.description')}
        </p>
      </div>

      {error && (
        <Alert data-slot="file-access-error" tone="danger" shouldAnnounce heading={t('settings.fileAccess.error')}>
          {error}
        </Alert>
      )}

      <div data-slot="file-access-saf" className="m-file-access__stack">
        <p data-slot="file-access-saf-label" className="m-file-access__label">
          {t('settings.fileAccess.safDirs')}
        </p>
        {safRoots.length === 0 ? (
          <EmptyState heading={t('settings.fileAccess.safEmpty')} headingLevel={3} size="sm" />
        ) : (
          <ul data-slot="file-access-saf-list" className="m-file-access__roots">
            {safRoots.map((root) => (
              <li key={root.uri} data-slot="file-access-saf-root" className="m-file-access__root">
                <div data-slot="file-access-saf-root-text" className="m-file-access__root-text">
                  <div
                    data-slot="file-access-saf-root-name"
                    onPointerEnter={titleIfTruncated}
                    className="m-file-access__root-name"
                  >
                    {root.display_name}
                  </div>
                  <div
                    data-slot="file-access-saf-root-prefix"
                    onPointerEnter={titleIfTruncated}
                    className="m-file-access__root-prefix"
                  >
                    {root.virtual_prefix}
                  </div>
                </div>
                <TooltipTrigger>
                  <Button
                    variant="ghost"
                    icon={<X />}
                    size="sm"
                    onPress={() => handleRemove(root.uri)}
                    aria-label={t('settings.fileAccess.removeDir')}
                  />
                  <Tooltip>{t('settings.fileAccess.removeDir')}</Tooltip>
                </TooltipTrigger>
              </li>
            ))}
          </ul>
        )}
        <Button icon={<FolderOpen />} variant="secondary" onPress={handleAddDirectory} isDisabled={picking}>
          {t('settings.fileAccess.addDir')}
        </Button>
      </div>

      <div data-slot="file-access-manage" className="m-file-access__stack">
        <Switch
          variant="card"
          aria-label={t('settings.fileAccess.manageToggle')}
          aria-describedby="manage-storage-hint"
          isSelected={manageEnabled}
          onChange={handleManageToggle}
        >
          {t('settings.fileAccess.manageToggle')}
        </Switch>
        <p id="manage-storage-hint" data-slot="file-access-manage-hint" className="m-file-access__hint">
          {manageEnabled && !manageGranted
            ? t('settings.fileAccess.manageNotGranted')
            : t('settings.fileAccess.manageHint')}
        </p>
      </div>

      <p data-slot="file-access-approval-note" className="m-file-access__hint">
        {t('settings.fileAccess.approvalNote')}
      </p>
    </div>
  )
}
