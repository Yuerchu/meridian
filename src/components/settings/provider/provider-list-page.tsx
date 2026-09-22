import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Cloud } from '@gravity-ui/icons'
import { Alert, Button, EmptyState, ListView, Tooltip, TooltipTrigger } from '@/components/base'
import { ProviderMark } from '@/components/ui/provider-icon'
import { api } from '@/api'
import type { ProviderInfoResponse } from '@/types'
import { SettingsSkeleton } from '../primitives'
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
      name: entry?.name ?? 'New Provider',
      providerType: entry?.provider_type ?? 'openai',
      baseUrl: defaultUrlFor(auth, format) ?? '',
      apiFormat: format,
      catalogId: entry?.id ?? null,
      authOption: auth?.id ?? null,
    })
    await refresh()
    onOpen(created.id)
  }, [refresh, onOpen])

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
              variant="outline"
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
    <SettingsPage
      title={t('settings.provider.title')}
      width="wide"
      actions={
        <TooltipTrigger delay={0}>
          <Button
            iconOnly
            aria-label={t('settings.provider.addProvider')}
            variant="ghost"
            onPress={() => void handleCreate()}
          >
            <Plus className="w-4 h-4" />
          </Button>
          <Tooltip placement="top">{t('settings.provider.addProvider')}</Tooltip>
        </TooltipTrigger>
      }
    >
      {/* `selectionMode="none"`: a row is a way in rather than a thing to
          select, and a selected row would keep a highlight on a page nobody is
          looking at any more. */}
      <ListView
        aria-label={t('settings.provider.title')}
        className="flex flex-col gap-1"
        selectionMode="none"
        variant="secondary"
        onAction={(key) => typeof key === 'string' && onOpen(key)}
        renderEmptyState={() => (
          // The text used to point at the "+" in the header, which is what an
          // empty state has an action slot for.
          <EmptyState size="sm">
            <EmptyState.Media variant="icon">
              <Cloud />
            </EmptyState.Media>
            <EmptyState.Header>
              <EmptyState.Title>{t('settings.provider.noProviders')}</EmptyState.Title>
            </EmptyState.Header>
            <EmptyState.Content>
              <Button variant="outline" onPress={() => void handleCreate()}>
                <Plus className="w-4 h-4" />
                {t('settings.provider.addProvider')}
              </Button>
            </EmptyState.Content>
          </EmptyState>
        )}
      >
        {providers.map((provider) => {
          return (
            <ListView.Item
              key={provider.id}
              id={provider.id}
              textValue={provider.name}
              className="min-h-11 rounded-lg border-b-0 px-3 py-2"
            >
              <ListView.ItemContent>
                <span
                  data-slot="provider-row-icon"
                  className="flex size-4 shrink-0 items-center justify-center text-text-secondary"
                >
                  <ProviderMark
                    icon={provider.icon}
                    catalogId={provider.catalog_id}
                    providerType={provider.provider_type}
                    size={16}
                  />
                </span>
                <ListView.Title className="text-body-regular">{provider.name}</ListView.Title>
              </ListView.ItemContent>
            </ListView.Item>
          )
        })}
      </ListView>
    </SettingsPage>
  )
}
