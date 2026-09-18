import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Xmark } from '@gravity-ui/icons'
import { Button, Tooltip, TooltipTrigger } from '@/components/base'
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

  const refreshGranted = useCallback(() => {
    api
      .getManageStorageStatus()
      .then(setManageGranted)
      .catch((e) => {
        console.error('getManageStorageStatus failed:', e)
      })
  }, [])

  useEffect(() => {
    api.getPreference({ key: 'android.manage_storage_enabled' }).then(({ value }) => {
      setManageEnabled(value ?? false)
    })
    api
      .listSafRoots()
      .then(setSafRoots)
      .catch(() => {})
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
  }, [refreshGranted])

  const handleManageToggle = async (checked: boolean) => {
    setManageEnabled(checked)
    await api.setPreference({ key: 'android.manage_storage_enabled', value: checked })
    if (checked && !manageGranted) {
      try {
        await api.requestManageStorage()
      } catch (e) {
        console.error('requestManageStorage failed:', e)
      }
    }
  }

  const handleAddDirectory = async () => {
    setPicking(true)
    try {
      setSafRoots(await api.pickSafDirectory())
    } catch (e) {
      console.error('pickSafDirectory failed:', e)
    } finally {
      setPicking(false)
    }
  }

  const handleRemove = async (uri: string) => {
    try {
      setSafRoots(await api.removeSafRoot(uri))
    } catch {
      // ignore
    }
  }

  return (
    <div data-slot="android-file-access" className="space-y-4">
      <div data-slot="file-access-heading">
        <h3 data-slot="file-access-title" className="text-sm font-medium">
          {t('settings.fileAccess.title')}
        </h3>
        <p data-slot="file-access-description" className="text-xs text-muted">
          {t('settings.fileAccess.description')}
        </p>
      </div>

      <div data-slot="file-access-saf" className="space-y-1.5">
        <p data-slot="file-access-saf-label" className="block text-xs font-medium text-muted">
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
                className="flex items-center justify-between rounded-md border px-2 py-1.5 text-xs"
              >
                <div data-slot="file-access-saf-root-text" className="min-w-0">
                  <div data-slot="file-access-saf-root-name" className="truncate font-medium">
                    {root.display_name}
                  </div>
                  <div data-slot="file-access-saf-root-prefix" className="truncate text-xs text-muted">
                    {root.virtual_prefix}
                  </div>
                </div>
                <TooltipTrigger delay={0}>
                  <Button
                    variant="ghost"
                    iconOnly
                    className="shrink-0"
                    onClick={() => handleRemove(root.uri)}
                    aria-label={t('settings.fileAccess.removeDir')}
                  >
                    <Xmark className="h-3.5 w-3.5" />
                  </Button>
                  <Tooltip>{t('settings.fileAccess.removeDir')}</Tooltip>
                </TooltipTrigger>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" onClick={handleAddDirectory} disabled={picking}>
          <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
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
        <p id="manage-storage-hint" data-slot="file-access-manage-hint" className="text-xs text-muted">
          {manageEnabled && !manageGranted
            ? t('settings.fileAccess.manageNotGranted')
            : t('settings.fileAccess.manageHint')}
        </p>
      </div>

      <p data-slot="file-access-approval-note" className="text-xs text-muted">
        {t('settings.fileAccess.approvalNote')}
      </p>
    </div>
  )
}
