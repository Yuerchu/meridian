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
import { Switch } from '@/components/yuerchu-ui/components/switch/switch'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { ModelIcon } from '@/components/ui/model-icon'
import { SettingsHeader, SettingsPane, SettingsSelect, SettingsSkeleton } from '../primitives'
import type { LogicalModelInfoResponse, ModelDeploymentInfoResponse, RoutingPolicy } from '@/types'

const ROUTING_POLICIES: RoutingPolicy[] = ['sticky_manual', 'auto_failover_stateless', 'user_opt_in_failover']

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCanonicalId, setNewCanonicalId] = useState('')
  const [newFamily, setNewFamily] = useState('')
  const [newContextWindow, setNewContextWindow] = useState('128000')
  const [newPolicy, setNewPolicy] = useState<RoutingPolicy>('sticky_manual')
  const [submitting, setSubmitting] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const list = await api.logicalModels.list()
      setModels(list)
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

  const handleCreate = useCallback(async () => {
    const trimmedName = newName.trim()
    const windowNum = Number.parseInt(newContextWindow, 10)
    if (!trimmedName || Number.isNaN(windowNum) || windowNum <= 0) return
    setSubmitting(true)
    try {
      setError(null)
      await api.logicalModels.create({
        name: trimmedName,
        canonical_id: newCanonicalId.trim() || null,
        capability_domain: 'chat',
        family: newFamily.trim() || null,
        icon: null,
        routing_policy: newPolicy,
        context_window: windowNum,
        compact_threshold: Math.max(1, Math.min(windowNum - 1, Math.round(windowNum * 0.8))),
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
      setNewFamily('')
      setNewContextWindow('128000')
      setNewPolicy('sticky_manual')
      await refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setSubmitting(false)
    }
  }, [newName, newCanonicalId, newFamily, newContextWindow, newPolicy, refresh])

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
        {models.length === 0 ? (
          <EmptyState
            heading={t('settings.models.empty')}
            headingLevel={3}
            description={t('settings.models.emptyHint')}
            size="sm"
          />
        ) : (
          <div className="m-models-settings__list">
            {models.map(({ profile, deployments }) => (
              <section key={profile.id} data-slot="logical-model-card" className="m-models-settings__card">
                <div className="m-models-settings__card-header">
                  <div className="m-models-settings__title-group">
                    <div className="m-models-settings__title-row">
                      <ModelIcon model={profile.canonical_id ?? profile.name} size={18} />
                      <span className="m-models-settings__name">{profile.name}</span>
                      {profile.canonical_id && (
                        <span className="m-models-settings__canonical">{profile.canonical_id}</span>
                      )}
                    </div>
                    <span className="m-models-settings__meta">
                      {formatCompactWindow(profile.context_window, locale)} ·{' '}
                      {t('settings.models.deploymentsCount', { count: deployments.length })}
                    </span>
                  </div>
                  <div className="m-models-settings__controls">
                    <SettingsSelect
                      ariaLabel={`${profile.name} ${t('settings.models.routingPolicy')}`}
                      value={profile.routing_policy}
                      options={policyOptions}
                      onChange={(next) => void handlePolicyChange(profile.id, next)}
                    />
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
            ))}
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
          <TextField
            label={t('settings.models.contextWindow')}
            name="logicalModelContextWindow"
            value={newContextWindow}
            onChange={setNewContextWindow}
          />
          <SettingsSelect
            ariaLabel={t('settings.models.routingPolicy')}
            value={newPolicy}
            options={policyOptions}
            onChange={(next) => setNewPolicy(next as RoutingPolicy)}
          />
        </div>
      </Drawer>

      {confirmDialog}
    </SettingsPane>
  )
}
