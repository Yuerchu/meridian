import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Button } from '@/components/base'
import { ProviderMark } from '@/components/ui/provider-icon'
import { api } from '@/api'
import type { ProviderInfoResponse } from '@/types'
import { SettingsAddRow, SettingsCard, SettingsLinkRow, SettingsSkeleton } from '../primitives'
import { SettingsPage } from '../settings-page'
import { useSettingsResume } from '../settings-stack'
import { defaultUrlFor, loadProviderCatalog } from './catalog'

/**
 * Every provider, and the way into one.
 *
 * Fetches on mount and again whenever the stack comes back to it
 * (`useSettingsResume`) — so a rename, a delete or a provider created on
 * another device is picked up with no callback threaded down and no cache to
 * invalidate. That is the whole reason the pages fetch by id rather than being
 * handed rows.
 *
 * The second half is not decoration. Levels stay mounted, so this component is
 * never remounted by a `pop`; without the resume, a delete unwound onto a list
 * still showing the row that no longer exists.
 *
 * Nothing is auto-selected. The list used to open its first row on a wide
 * screen because the second column would otherwise be empty; there is no second
 * column now, and opening a page nobody asked for would put a back button in
 * front of somebody who has not gone anywhere.
 */
export function ProviderListPage({ onOpen }: { onOpen: (providerId: string) => void }) {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<ProviderInfoResponse[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const initialized = useRef(false)

  const refresh = useCallback(async () => {
    setProviders(await api.listProviders())
  }, [])

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    void refresh()
      .catch((reason) => setLoadError(String(reason)))
      .finally(() => setLoading(false))
  }, [refresh])

  // Coming back from a provider page: it may have been renamed or deleted, and
  // this list has been mounted the whole time it was covered.
  useSettingsResume(() => void refresh().catch((reason) => setLoadError(String(reason))))

  /**
   * A new row starts as the first vendor in the catalog, prefilled from it and
   * stamped with which vendor it is. The hardcoded OpenAI defaults that used to
   * be here are now just what the catalog's first entry says.
   *
   * `catalogId` is passed even though the backend could infer it from the URL:
   * the user picking a vendor is a statement, and it must survive them editing
   * the address afterwards — which inference cannot do.
   */
  const handleCreate = useCallback(async () => {
    const entry = (await loadProviderCatalog())[0]
    const auth = entry?.auth[0]
    const format = auth?.api_formats[0] ?? 'chat_completions'
    const created = await api.createProvider({
      name: entry?.name ?? t('settings.provider.newProviderName'),
      providerType: entry?.provider_type ?? 'openai',
      baseUrl: defaultUrlFor(auth, format) ?? '',
      apiFormat: format,
      catalogId: entry?.id ?? null,
      authOption: auth?.id ?? null,
    })
    await refresh()
    onOpen(created.id)
  }, [refresh, onOpen, t])

  if (loading) return <SettingsSkeleton className="max-w-3xl" />

  if (loadError && providers.length === 0) {
    return (
      <SettingsPage title={t('settings.provider.title')} width="wide">
        <Alert status="danger" role="alert">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{t('settings.provider.loadError')}</Alert.Title>
            <Alert.Description className="break-all">{loadError}</Alert.Description>
            <Button
              size="small"
              variant="secondary"
              onPress={() => {
                setLoadError(null)
                setLoading(true)
                void refresh()
                  .catch((reason) => setLoadError(String(reason)))
                  .finally(() => setLoading(false))
              }}
            >
              {t('settings.provider.retry')}
            </Button>
          </Alert.Content>
        </Alert>
      </SettingsPage>
    )
  }

  return (
    <SettingsPage title={t('settings.provider.title')} subtitle={t('settings.provider.subtitle')} width="wide">
      {/* settings-tools.tsx's server list: one card, a row per provider with
          its mark and name on one line, and the way to add another as the
          card's last row rather than a lone "+" in the header. The row says
          where the provider points, which is what tells a relay apart from the
          vendor it fronts when both draw the same mark. */}
      <SettingsCard data-slot="provider-list">
        {providers.map((provider) => (
          <SettingsLinkRow
            key={provider.id}
            // What the stack's focus return looks for when this page comes back.
            data-key={provider.id}
            icon={
              <ProviderMark
                icon={provider.icon}
                catalogId={provider.catalog_id}
                providerType={provider.provider_type}
                size={20}
              />
            }
            label={provider.name}
            value={hostOf(provider.base_url)}
            onPress={() => onOpen(provider.id)}
          />
        ))}
        <SettingsAddRow
          label={t('settings.provider.addProvider')}
          description={providers.length === 0 ? t('settings.provider.noProviders') : undefined}
          onPress={() => void handleCreate()}
        />
      </SettingsCard>
    </SettingsPage>
  )
}

/** The host a provider points at, or nothing when its URL does not parse. */
function hostOf(url: string): string | undefined {
  try {
    return new URL(url).host || undefined
  } catch {
    return undefined
  }
}
