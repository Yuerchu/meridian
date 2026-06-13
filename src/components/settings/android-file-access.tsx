import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
    api.getManageStorageStatus().then(setManageGranted).catch(() => {})
  }, [])

  useEffect(() => {
    api.getPreference('android.manage_storage_enabled').then((v) => {
      setManageEnabled(v === 'true')
    })
    api.listSafRoots().then(setSafRoots).catch(() => {})
    refreshGranted()
    // Re-check the system grant when returning from the system settings page
    const onFocus = () => refreshGranted()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshGranted])

  const handleManageToggle = (checked: boolean) => {
    setManageEnabled(checked)
    api.setPreference('android.manage_storage_enabled', checked ? 'true' : 'false')
    if (checked && !manageGranted) {
      api.requestManageStorage().catch(() => {})
    }
  }

  const handleAddDirectory = async () => {
    setPicking(true)
    try {
      setSafRoots(await api.pickSafDirectory())
    } catch {
      // cancelled or unavailable
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
        <p className="text-[11px] text-muted-foreground">
          {t('settings.fileAccess.description')}
        </p>
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-muted-foreground">
          {t('settings.fileAccess.safDirs')}
        </label>
        {safRoots.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">
            {t('settings.fileAccess.safEmpty')}
          </p>
        ) : (
          <ul className="space-y-1">
            {safRoots.map((root) => (
              <li
                key={root.uri}
                className="flex items-center justify-between rounded-md border px-2 py-1.5 text-xs"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{root.display_name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {root.virtual_prefix}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => handleRemove(root.uri)}
                  aria-label={t('settings.fileAccess.removeDir')}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" size="sm" onClick={handleAddDirectory} disabled={picking}>
          <FolderOpen className="mr-1.5 h-3.5 w-3.5" />
          {t('settings.fileAccess.addDir')}
        </Button>
      </div>

      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={manageEnabled}
            onCheckedChange={(checked) => handleManageToggle(!!checked)}
          />
          {t('settings.fileAccess.manageToggle')}
        </label>
        <p className="text-[11px] text-muted-foreground">
          {manageEnabled && !manageGranted
            ? t('settings.fileAccess.manageNotGranted')
            : t('settings.fileAccess.manageHint')}
        </p>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {t('settings.fileAccess.approvalNote')}
      </p>
    </div>
  )
}
