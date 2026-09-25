import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, X } from '@keyline-icons/react/two-tone'
import { Alert, Button, Tooltip, TooltipTrigger } from '@/components/base'
import { CellSwitch } from '@/components/base'
import { EmptyState } from '@/components/base'
import { api } from '@/api'
import type { SafRootListResponse } from '@/types'

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
    api.getManageStorageStatus().then(setManageGranted).catch(report)
  }, [report])

  useEffect(() => {
    api
      .getPreference({ key: 'android.manage_storage_enabled' })
      .then(({ value }) => setManageEnabled(value ?? false))
      .catch(report)
    api.listSafRoots().then(setSafRoots).catch(report)
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
      await api.setPreference({ key: 'android.manage_storage_enabled', value: checked })
    } catch (e) {
      // Not written, so the switch goes back to what is actually stored.
      setManageEnabled(!checked)
      report(e)
      return
    }
    if (checked && !manageGranted) {
      try {
        await api.requestManageStorage()
      } catch (e) {
        report(e)
      }
    }
  }

  const handleAddDirectory = async () => {
    setError(null)
    setPicking(true)
    try {
      setSafRoots(await api.pickSafDirectory())
    } catch (e) {
      report(e)
    } finally {
      setPicking(false)
    }
  }

  const handleRemove = async (uri: string) => {
    setError(null)
    try {
      setSafRoots(await api.removeSafRoot(uri))
    } catch (e) {
      report(e)
    }
  }

  return (
    <div data-slot="android-file-access" className="space-y-4">
      <div data-slot="file-access-heading">
        <h3 data-slot="file-access-title" className="text-body-medium">
          {t('settings.fileAccess.title')}
        </h3>
        <p data-slot="file-access-description" className="text-caption-1-regular text-text-secondary">
          {t('settings.fileAccess.description')}
        </p>
      </div>

      {error && (
        <Alert data-slot="file-access-error" status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t('settings.fileAccess.error')}</Alert.Title>
            <Alert.Description className="break-all">{error}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      <div data-slot="file-access-saf" className="space-y-1.5">
        <p data-slot="file-access-saf-label" className="block text-caption-1-medium text-text-secondary">
          {t('settings.fileAccess.safDirs')}
        </p>
        {safRoots.length === 0 ? (
          <EmptyState size="sm">
            <EmptyState.Header>
              <EmptyState.Title>{t('settings.fileAccess.safEmpty')}</EmptyState.Title>
            </EmptyState.Header>
          </EmptyState>
        ) : (
          <ul data-slot="file-access-saf-list" className="space-y-1">
            {safRoots.map((root) => (
              <li
                key={root.uri}
                data-slot="file-access-saf-root"
                className="flex items-center justify-between rounded-md border px-2 py-1.5 text-caption-1-regular"
              >
                <div data-slot="file-access-saf-root-text" className="min-w-0">
                  <div data-slot="file-access-saf-root-name" className="truncate text-caption-1-medium">
                    {root.display_name}
                  </div>
                  <div
                    data-slot="file-access-saf-root-prefix"
                    className="truncate text-caption-1-regular text-text-secondary"
                  >
                    {root.virtual_prefix}
                  </div>
                </div>
                <TooltipTrigger delay={0}>
                  <Button
                    variant="neutral"
                    iconOnly
                    leadingIcon={X}
                    size="small"
                    className="shrink-0"
                    onPress={() => handleRemove(root.uri)}
                    aria-label={t('settings.fileAccess.removeDir')}
                  />
                  <Tooltip>{t('settings.fileAccess.removeDir')}</Tooltip>
                </TooltipTrigger>
              </li>
            ))}
          </ul>
        )}
        <Button leadingIcon={FolderOpen} variant="secondary" onPress={handleAddDirectory} isDisabled={picking}>
          {t('settings.fileAccess.addDir')}
        </Button>
      </div>

      <div data-slot="file-access-manage" className="space-y-1.5">
        <CellSwitch
          aria-label={t('settings.fileAccess.manageToggle')}
          aria-describedby="manage-storage-hint"
          isSelected={manageEnabled}
          onChange={handleManageToggle}
        >
          <CellSwitch.Trigger className="pointer-coarse:h-11">
            <CellSwitch.Label>{t('settings.fileAccess.manageToggle')}</CellSwitch.Label>
            <CellSwitch.Control />
          </CellSwitch.Trigger>
        </CellSwitch>
        <p
          id="manage-storage-hint"
          data-slot="file-access-manage-hint"
          className="text-caption-1-regular text-text-secondary"
        >
          {manageEnabled && !manageGranted
            ? t('settings.fileAccess.manageNotGranted')
            : t('settings.fileAccess.manageHint')}
        </p>
      </div>

      <p data-slot="file-access-approval-note" className="text-caption-1-regular text-text-secondary">
        {t('settings.fileAccess.approvalNote')}
      </p>
    </div>
  )
}
