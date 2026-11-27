import './models-settings.css'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bin, GitBranch, Plus, TriangleAlert } from '@keyline-icons/react/two-tone'
import { api } from '@/api'
import { useConfirm } from '@/hooks/use-confirm'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { Drawer } from '@/components/yuerchu-ui/components/drawer/drawer'
import { EmptyState } from '@/components/yuerchu-ui/components/empty-state/empty-state'
import { Segment, SegmentedControl } from '@/components/yuerchu-ui/components/segmented-control/segmented-control'
import { Switch } from '@/components/yuerchu-ui/components/switch/switch'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { ModelIcon } from '@/components/ui/model-icon'
import { SettingsHeader, SettingsPane, SettingsSelect, SettingsSkeleton } from '../primitives'
import type {
  CapabilityDomain,
  LogicalModelInfoResponse,
  ModelDeploymentInfoResponse,
  ProviderInfoResponse,
  RoutingPolicy,
} from '@/types'

const ROUTING_POLICIES: RoutingPolicy[] = ['sticky_manual', 'auto_failover_stateless', 'user_opt_in_failover']
const DOMAIN_FILTERS = ['all', 'chat', 'image_gen', 'video_gen'] as const
type DomainFilter = (typeof DOMAIN_FILTERS)[number]
const CREATABLE_DOMAINS: CapabilityDomain[] = ['chat', 'image_gen', 'video_gen']
const AUTO_PROTOCOL = '__auto__'
const PROTOCOLS_BY_DOMAIN: Record<string, readonly string[]> = {
  chat: ['openai_chat', 'openai_responses', 'anthropic_messages', 'google_generate_content', 'google_interactions'],
  image_gen: ['openai_images', 'google_image_gen', 'volcengine_seedream'],
  video_gen: ['google_veo', 'volcengine_seedance', 'kling_video', 'minimax_video', 'vidu_video', 'bailian_wan_video'],
}

function formatCompactWindow(tokens: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(tokens)
}

function DeploymentRow({
  deployment,
  canSplit,
  onToggleEnabled,
  onChangePriority,
  onSplit,
  onUnlink,
}: {
  deployment: ModelDeploymentInfoResponse
  canSplit: boolean
  onToggleEnabled: (deployment: ModelDeploymentInfoResponse, enabled: boolean) => void
  onChangePriority: (deployment: ModelDeploymentInfoResponse, priority: number) => void
  onSplit: (deployment: ModelDeploymentInfoResponse) => void
  onUnlink: (deployment: ModelDeploymentInfoResponse) => void
}) {
  const { t } = useTranslation()
  const [priorityDraft, setPriorityDraft] = useState(String(deployment.priority))

  useEffect(() => {
    setPriorityDraft(String(deployment.priority))
  }, [deployment.priority])

  const commitPriority = () => {
    const parsed = Number.parseInt(priorityDraft, 10)
    if (!Number.isNaN(parsed) && parsed !== deployment.priority) {
      onChangePriority(deployment, parsed)
    } else {
      setPriorityDraft(String(deployment.priority))
    }
  }

  return (
    <div data-slot="model-deployment-row" className="m-models-settings__deployment">
      <div className="m-models-settings__deployment-main">
        <div className="m-models-settings__deployment-title">
          <span className="m-models-settings__provider-name">{deployment.provider_name}</span>
          <span className="m-models-settings__wire-id">{deployment.model_id}</span>
          {deployment.compliance.status === 'standard' && (
            <span data-slot="deployment-compliance" data-status="standard" className="m-models-settings__compliance">
              {t('settings.models.protocolStandard')} · {deployment.effective_protocol}
            </span>
          )}
          {deployment.compliance.status === 'degraded' && (
            <span data-slot="deployment-compliance" data-status="degraded" className="m-models-settings__compliance">
              <TriangleAlert aria-hidden size={12} />
              {t('settings.models.protocolDegraded')} · {deployment.effective_protocol}
            </span>
          )}
        </div>
        {deployment.compliance.status === 'degraded' && (
          <p data-slot="deployment-degraded-hint" className="m-models-settings__degraded-hint">
            {t('settings.models.protocolDegradedHint', {
              actual: deployment.effective_protocol,
              expected: deployment.compliance.expected.join(' / '),
              lost: deployment.compliance.lost_capabilities.join(', '),
            })}
          </p>
        )}
      </div>
      <div className="m-models-settings__deployment-actions">
        <div className="m-models-settings__priority">
          <TextField
            aria-label={`${deployment.provider_name} ${t('settings.models.priority')}`}
            name={`priority-${deployment.id}`}
            value={priorityDraft}
            onChange={setPriorityDraft}
            onBlur={commitPriority}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitPriority()
            }}
          />
        </div>
        <Switch
          size="sm"
          aria-label={deployment.provider_name}
          isSelected={deployment.is_enabled}
          onChange={(enabled) => onToggleEnabled(deployment, enabled)}
        />
        {canSplit && (
          <Button size="sm" variant="secondary" icon={<GitBranch />} onPress={() => onSplit(deployment)}>
            {t('settings.models.split')}
          </Button>
        )}
        <Button size="sm" variant="secondary" onPress={() => onUnlink(deployment)}>
          {t('settings.models.unlink')}
        </Button>
      </div>
    </div>
  )
}

export function ModelsSettings() {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const { confirm, confirmDialog } = useConfirm()
  const [models, setModels] = useState<LogicalModelInfoResponse[]>([])
  const [providers, setProviders] = useState<ProviderInfoResponse[]>([])
  const [domainFilter, setDomainFilter] = useState<DomainFilter>('all')
  const [defaultImageModelId, setDefaultImageModelId] = useState<string | null>(null)
  const [defaultVideoModelId, setDefaultVideoModelId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCanonicalId, setNewCanonicalId] = useState('')
  const [newDomain, setNewDomain] = useState<CapabilityDomain>('chat')
  const [newFamily, setNewFamily] = useState('')
  const [newContextWindow, setNewContextWindow] = useState('128000')
  const [newPolicy, setNewPolicy] = useState<RoutingPolicy>('sticky_manual')
  const [submitting, setSubmitting] = useState(false)
  const [attachTarget, setAttachTarget] = useState<LogicalModelInfoResponse | null>(null)
  const [attachProviderId, setAttachProviderId] = useState('')
  const [attachModelId, setAttachModelId] = useState('')
  const [attachProtocol, setAttachProtocol] = useState<string>(AUTO_PROTOCOL)
  const [attaching, setAttaching] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const [list, providerList, imgPref, vidPref] = await Promise.all([
        api.logicalModels.list(),
        api.providers?.list?.().catch(() => []) ?? Promise.resolve([]),
        api.preferences?.get?.({ key: 'media.default_image_model_id' }).catch(() => null) ?? Promise.resolve(null),
        api.preferences?.get?.({ key: 'media.default_video_model_id' }).catch(() => null) ?? Promise.resolve(null),
      ])
      setModels(list)
      setProviders(providerList)
      setDefaultImageModelId(imgPref?.key === 'media.default_image_model_id' ? imgPref.value : null)
      setDefaultVideoModelId(vidPref?.key === 'media.default_video_model_id' ? vidPref.value : null)
    } catch (err) {
      setError(String(err))
    }
  }, [])

  useEffect(() => {
    void refresh().finally(() => setLoading(false))
  }, [refresh])

  const policyOptions = ROUTING_POLICIES.map((policy) => ({
    value: policy,
    label: t(`settings.models.routingPolicy.${policy}`),
  }))

  const domainOptions = CREATABLE_DOMAINS.map((domain) => ({
    value: domain,
    label: t(`settings.models.domain.${domain}`),
  }))

  const handleSetDefaultMediaModel = useCallback(
    async (domain: 'image_gen' | 'video_gen', profileId: string | null) => {
      try {
        setError(null)
        if (domain === 'image_gen') {
          await api.preferences.set({ key: 'media.default_image_model_id', value: profileId })
          setDefaultImageModelId(profileId)
        } else {
          await api.preferences.set({ key: 'media.default_video_model_id', value: profileId })
          setDefaultVideoModelId(profileId)
        }
      } catch (err) {
        setError(String(err))
      }
    },
    [],
  )

  const handlePolicyChange = useCallback(
    async (profileId: string, next: string) => {
      try {
        setError(null)
        await api.logicalModels.update({ id: profileId, routing_policy: next as RoutingPolicy })
        await refresh()
      } catch (err) {
        setError(String(err))
      }
    },
    [refresh],
  )

  const handleDeleteModel = useCallback(
    async (profileId: string) => {
      const ok = await confirm({
        description: t('settings.models.deleteConfirm'),
        confirmLabel: t('common.delete'),
        tone: 'danger',
      })
      if (!ok) return
      try {
        setError(null)
        await api.logicalModels.delete({ id: profileId, cascade_deployments: true })
        await refresh()
      } catch (err) {
        setError(String(err))
      }
    },
    [confirm, t, refresh],
  )

  const handleToggleDeployment = useCallback(
    async (deployment: ModelDeploymentInfoResponse, isEnabled: boolean) => {
      try {
        setError(null)
        await api.modelDeployments.update({ id: deployment.id, is_enabled: isEnabled })
        await refresh()
      } catch (err) {
        setError(String(err))
      }
    },
    [refresh],
  )

  const handleChangePriority = useCallback(
    async (deployment: ModelDeploymentInfoResponse, priority: number) => {
      try {
        setError(null)
        await api.modelDeployments.update({ id: deployment.id, priority })
        await refresh()
      } catch (err) {
        setError(String(err))
      }
    },
    [refresh],
  )

  const handleSplitDeployment = useCallback(
    async (deployment: ModelDeploymentInfoResponse) => {
      try {
        setError(null)
        await api.modelDeployments.switchProfile({
          deployment_id: deployment.id,
          target_profile_id: null,
          new_profile_name: `${deployment.model_id} (${deployment.provider_name})`,
        })
        await refresh()
      } catch (err) {
        setError(String(err))
      }
    },
    [refresh],
  )

  const handleUnlinkDeployment = useCallback(
    async (deployment: ModelDeploymentInfoResponse) => {
      try {
        setError(null)
        await api.modelDeployments.delete({ id: deployment.id })
        await refresh()
      } catch (err) {
        setError(String(err))
      }
    },
    [refresh],
  )

  const openAttachDrawer = useCallback(
    (item: LogicalModelInfoResponse) => {
      setAttachTarget(item)
      const firstProvider = providers.find((p) => p.is_enabled) ?? providers[0]
      setAttachProviderId(firstProvider?.id ?? '')
      const suggested = item.profile.canonical_id?.split('/').pop() ?? item.profile.name
      setAttachModelId(suggested)
      setAttachProtocol(AUTO_PROTOCOL)
    },
    [providers],
  )

  const handleAttachProvider = useCallback(async () => {
    if (!attachTarget || !attachProviderId || !attachModelId.trim()) return
    setAttaching(true)
    try {
      setError(null)
      await api.modelDeployments.attach({
        provider_id: attachProviderId,
        model_id: attachModelId.trim(),
        display_name: null,
        profile_id: attachTarget.profile.id,
        protocol_override: attachProtocol === AUTO_PROTOCOL ? null : attachProtocol,
        priority: null,
      })
      setAttachTarget(null)
      await refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setAttaching(false)
    }
  }, [attachTarget, attachProviderId, attachModelId, attachProtocol, refresh])

  const handleCreate = useCallback(async () => {
    const trimmedName = newName.trim()
    const isChat = newDomain === 'chat'
    const windowNum = isChat ? Number.parseInt(newContextWindow, 10) : 0
    if (!trimmedName || (isChat && (Number.isNaN(windowNum) || windowNum <= 0))) return
    setSubmitting(true)
    try {
      setError(null)
      await api.logicalModels.create({
        name: trimmedName,
        canonical_id: newCanonicalId.trim() || null,
        capability_domain: newDomain,
        family: newFamily.trim() || null,
        icon: null,
        routing_policy: newPolicy,
        context_window: windowNum,
        compact_threshold: isChat ? Math.max(1, Math.min(windowNum - 1, Math.round(windowNum * 0.8))) : 0,
        max_output_tokens: null,
        input_price: null,
        output_price: null,
        cache_read_price: null,
        cache_write_price: null,
        pricing_tiers: [],
        capability_overrides: null,
      })
      setCreating(false)
      setNewName('')
      setNewCanonicalId('')
      setNewDomain('chat')
      setNewFamily('')
      setNewContextWindow('128000')
      setNewPolicy('sticky_manual')
      await refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setSubmitting(false)
    }
  }, [newName, newCanonicalId, newDomain, newFamily, newContextWindow, newPolicy, refresh])

  const filteredModels =
    domainFilter === 'all' ? models : models.filter(({ profile }) => profile.capability_domain === domainFilter)

  if (loading) return <SettingsSkeleton />

  return (
    <SettingsPane>
      <SettingsHeader
        title={t('settings.models.title')}
        subtitle={t('settings.models.subtitle')}
        actions={
          <Button size="sm" icon={<Plus />} onPress={() => setCreating(true)}>
            {t('settings.models.create')}
          </Button>
        }
      />

      {error && (
        <Alert data-slot="models-settings-error" tone="danger" shouldAnnounce>
          {error}
        </Alert>
      )}

      <div data-slot="models-settings-list" className="m-models-settings">
        <SegmentedControl
          aria-label={t('settings.models.domainFilter')}
          selectedKey={domainFilter}
          onSelectionChange={(key) => setDomainFilter(key as DomainFilter)}
        >
          {DOMAIN_FILTERS.map((key) => (
            <Segment key={key} id={key}>
              {t(`settings.models.domain.${key}`)}
            </Segment>
          ))}
        </SegmentedControl>

        {filteredModels.length === 0 ? (
          <EmptyState
            heading={t('settings.models.empty')}
            headingLevel={3}
            description={t('settings.models.emptyHint')}
            size="sm"
          />
        ) : (
          <div className="m-models-settings__list">
            {filteredModels.map(({ profile, deployments }) => {
              const isDefaultMedia =
                (profile.capability_domain === 'image_gen' && defaultImageModelId === profile.id) ||
                (profile.capability_domain === 'video_gen' && defaultVideoModelId === profile.id)
              return (
                <section key={profile.id} data-slot="logical-model-card" className="m-models-settings__card">
                  <div className="m-models-settings__card-header">
                    <div className="m-models-settings__title-group">
                      <div className="m-models-settings__title-row">
                        <ModelIcon model={profile.canonical_id ?? profile.name} size={18} />
                        <span className="m-models-settings__name">{profile.name}</span>
                        <span className="m-models-settings__canonical">
                          {t(`settings.models.domain.${profile.capability_domain}`)}
                        </span>
                        {profile.canonical_id && (
                          <span className="m-models-settings__canonical">{profile.canonical_id}</span>
                        )}
                      </div>
                      <span className="m-models-settings__meta">
                        {profile.capability_domain === 'chat'
                          ? `${formatCompactWindow(profile.context_window, locale)} · `
                          : ''}
                        {t('settings.models.deploymentsCount', { count: deployments.length })}
                      </span>
                    </div>
                    <div className="m-models-settings__controls">
                      {(profile.capability_domain === 'image_gen' || profile.capability_domain === 'video_gen') && (
                        <Button
                          size="sm"
                          variant={isDefaultMedia ? 'primary' : 'secondary'}
                          onPress={() =>
                            void handleSetDefaultMediaModel(
                              profile.capability_domain as 'image_gen' | 'video_gen',
                              isDefaultMedia ? null : profile.id,
                            )
                          }
                        >
                          {isDefaultMedia
                            ? t('settings.models.defaultMediaActive')
                            : t('settings.models.setDefaultMedia')}
                        </Button>
                      )}
                      <SettingsSelect
                        ariaLabel={`${profile.name} ${t('settings.models.routingPolicy')}`}
                        value={profile.routing_policy}
                        options={policyOptions}
                        onChange={(next) => void handlePolicyChange(profile.id, next)}
                      />
                      {providers.length > 0 && (
                        <Button
                          data-slot="logical-model-attach-btn"
                          size="sm"
                          variant="secondary"
                          icon={<Plus />}
                          onPress={() => openAttachDrawer({ profile, deployments })}
                        >
                          {t('settings.models.attachProvider')}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="destructive"
                        icon={<Bin />}
                        aria-label={`${t('common.delete')} ${profile.name}`}
                        onPress={() => void handleDeleteModel(profile.id)}
                      >
                        {t('common.delete')}
                      </Button>
                    </div>
                  </div>

                  {deployments.length === 0 ? (
                    <p data-slot="logical-model-no-deployments" className="m-models-settings__empty-channels">
                      {t('settings.models.noDeployments')}
                    </p>
                  ) : (
                    <div className="m-models-settings__deployments">
                      {deployments.map((dep) => (
                        <DeploymentRow
                          key={dep.id}
                          deployment={dep}
                          canSplit={deployments.length > 1}
                          onToggleEnabled={(d, enabled) => void handleToggleDeployment(d, enabled)}
                          onChangePriority={(d, priority) => void handleChangePriority(d, priority)}
                          onSplit={(d) => void handleSplitDeployment(d)}
                          onUnlink={(d) => void handleUnlinkDeployment(d)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>

      <Drawer
        isOpen={creating}
        onOpenChange={setCreating}
        side="bottom"
        size="sm"
        heading={t('settings.models.create')}
        footer={
          <>
            <Button variant="secondary" onPress={() => setCreating(false)}>
              {t('common.cancel')}
            </Button>
            <Button isDisabled={!newName.trim()} isPending={submitting} onPress={() => void handleCreate()}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <div className="m-models-settings__form">
          <TextField label={t('settings.models.name')} name="logicalModelName" value={newName} onChange={setNewName} />
          <SettingsSelect
            ariaLabel={t('settings.models.domainFilter')}
            value={newDomain}
            options={domainOptions}
            onChange={(next) => {
              const domain = next as CapabilityDomain
              setNewDomain(domain)
              if (domain === 'image_gen' || domain === 'video_gen') {
                setNewPolicy('auto_failover_stateless')
              } else {
                setNewPolicy('sticky_manual')
              }
            }}
          />
          <TextField
            label={t('settings.models.canonicalId')}
            name="logicalModelCanonicalId"
            value={newCanonicalId}
            placeholder={t('settings.models.canonicalIdPlaceholder')}
            onChange={setNewCanonicalId}
          />
          <TextField
            label={t('settings.models.family')}
            name="logicalModelFamily"
            value={newFamily}
            onChange={setNewFamily}
          />
          {newDomain === 'chat' && (
            <TextField
              label={t('settings.models.contextWindow')}
              name="logicalModelContextWindow"
              value={newContextWindow}
              onChange={setNewContextWindow}
            />
          )}
          <SettingsSelect
            ariaLabel={t('settings.models.routingPolicy')}
            value={newPolicy}
            options={policyOptions}
            onChange={(next) => setNewPolicy(next as RoutingPolicy)}
          />
        </div>
      </Drawer>

      <Drawer
        isOpen={attachTarget !== null}
        onOpenChange={(open) => {
          if (!open) setAttachTarget(null)
        }}
        side="bottom"
        size="sm"
        heading={attachTarget ? `${t('settings.models.attachProvider')} · ${attachTarget.profile.name}` : ''}
        footer={
          <>
            <Button variant="secondary" onPress={() => setAttachTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              isDisabled={!attachProviderId || !attachModelId.trim()}
              isPending={attaching}
              onPress={() => void handleAttachProvider()}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <div className="m-models-settings__form">
          <SettingsSelect
            label={t('settings.models.selectProvider')}
            value={attachProviderId}
            options={providers.map((p) => ({
              value: p.id,
              label:
                p.capability_domain !== 'chat'
                  ? `${p.name} (${t(`settings.models.domain.${p.capability_domain}`)})`
                  : p.name,
            }))}
            onChange={setAttachProviderId}
          />
          <TextField
            label={t('settings.models.remoteModelId')}
            name="attachRemoteModelId"
            value={attachModelId}
            placeholder={t('settings.models.remoteModelIdPlaceholder')}
            onChange={setAttachModelId}
          />
          <SettingsSelect
            label={t('settings.model.protocolOverride')}
            value={attachProtocol}
            options={[
              { value: AUTO_PROTOCOL, label: t('settings.model.protocolAuto') },
              ...(
                PROTOCOLS_BY_DOMAIN[attachTarget?.profile.capability_domain ?? 'chat'] ?? PROTOCOLS_BY_DOMAIN.chat
              ).map((proto) => ({ value: proto, label: proto })),
            ]}
            onChange={setAttachProtocol}
          />
        </div>
      </Drawer>

      {confirmDialog}
    </SettingsPane>
  )
}
