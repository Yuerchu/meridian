import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Xmark } from '@gravity-ui/icons'
import { Button } from '@heroui/react'
import { CellSwitch } from '@heroui-pro/react/cell-switch'
import { EmptyState } from '@heroui-pro/react/empty-state'
import { api } from '@/api'
import type { SafRootEntry } from '@/types'

/**
 * Android-only settings block: SAF directory grants + the
 * MANAGE_EXTERNAL_STORAGE ("All files access") opt-in switch.
 */
export function AndroidFileAccess() {
  const { t } = useTranslation()
  const [manageEnabled, setManageEnabled] = useState(false)
  const [manageGranted, setManageGranted] = useState(false)
  const [safRoots, setSafRoots] = useState<SafRootEntry[]>([])
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
    api.getPreference('android.manage_storage_enabled').then((v) => {
      setManageEnabled(v === 'true')
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
    await api.setPreference('android.manage_storage_enabled', checked ? 'true' : 'false')
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
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-medium">{t('settings.fileAccess.title')}</h3>
        <p className="text-xs text-muted">{t('settings.fileAccess.description')}</p>
      </div>

      <div className="space-y-1.5">
        <p className="block text-xs font-medium text-muted">{t('settings.fileAccess.safDirs')}</p>
        {safRoots.length === 0 ? (
          <EmptyState size="sm">
            <EmptyState.Header>
              <EmptyState.Title>{t('settings.fileAccess.safEmpty')}</EmptyState.Title>
            </EmptyState.Header>
          </EmptyState>
        ) : (
          <ul className="space-y-1">
            {safRoots.map((root) => (
              <li key={root.uri} className="flex items-center justify-between rounded-md border px-2 py-1.5 text-xs">
                <div className="min-w-0">
                  <div className="truncate font-medium">{root.display_name}</div>
                  <div className="truncate text-xs text-muted">{root.virtual_prefix}</div>
                </div>
                <Button
                  variant="ghost"
                  isIconOnly
                  className="shrink-0"
                  onClick={() => handleRemove(root.uri)}
                  aria-label={t('settings.fileAccess.removeDir')}
                >
                  <Xmark className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" onClick={handleAddDirectory} isDisabled={picking}>
          <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
          {t('settings.fileAccess.addDir')}
        </Button>
      </div>

      <div className="space-y-1.5">
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
        <p id="manage-storage-hint" className="text-xs text-muted">
          {manageEnabled && !manageGranted
            ? t('settings.fileAccess.manageNotGranted')
            : t('settings.fileAccess.manageHint')}
        </p>
      </div>

      <p className="text-xs text-muted">{t('settings.fileAccess.approvalNote')}</p>
    </div>
  )
}
