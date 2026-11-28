import './dream-panel.css'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '@/api'
import { decimal } from '@/lib/decimal'
import { draftToNumber, numberToDraft, PLAIN_INTEGER } from '@/lib/number-draft'
import type { DreamConfigInfoResponse, DreamRunInfoResponse, MemoryScope } from '@/types'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { NumberField } from '@/components/yuerchu-ui/components/number-field/number-field'
import { SettingsGroup, SettingsRow } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import { Switch } from '@/components/yuerchu-ui/components/switch/switch'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'

interface DreamPanelProps {
  targetScope: MemoryScope
  targetScopeId: string
  onMemoriesChanged: () => void
}

export function DreamPanel({ targetScope, targetScopeId, onMemoriesChanged }: DreamPanelProps) {
  const { t } = useTranslation()
  const [config, setConfig] = useState<DreamConfigInfoResponse | null>(null)
  const [runs, setRuns] = useState<DreamRunInfoResponse[]>([])
  const [cooldownDraft, setCooldownDraft] = useState('')
  const [minTurnsDraft, setMinTurnsDraft] = useState('')
  const [budgetDraft, setBudgetDraft] = useState('')
  const [running, setRunning] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [cfg, history] = await Promise.all([
        api.dream.getConfig(),
        api.dream.listRuns({ scope: null, scope_id: null, limit: 5 }),
      ])
      setConfig(cfg)
      setCooldownDraft(numberToDraft(cfg.cooldown_hours))
      setMinTurnsDraft(numberToDraft(cfg.min_turns))
      setBudgetDraft(String(cfg.daily_budget_usd))
      setRuns(history)
    } catch (reason) {
      setError(String(reason))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const persistConfig = useCallback(
    async (next: DreamConfigInfoResponse) => {
      const previous = config
      setConfig(next)
      setError(null)
      try {
        const saved = await api.dream.setConfig({
          enabled: next.enabled,
          model: next.model,
          cooldown_hours: next.cooldown_hours,
          min_turns: next.min_turns,
          daily_budget_usd: next.daily_budget_usd,
        })
        setConfig(saved)
        setCooldownDraft(numberToDraft(saved.cooldown_hours))
        setMinTurnsDraft(numberToDraft(saved.min_turns))
        setBudgetDraft(String(saved.daily_budget_usd))
      } catch (reason) {
        if (previous) setConfig(previous)
        setError(String(reason))
      }
    },
    [config],
  )

  const handleRunNow = useCallback(async () => {
    setRunning(true)
    setError(null)
    try {
      await api.dream.startRun({ scope: targetScope, scope_id: targetScopeId })
      await load()
      onMemoriesChanged()
    } catch (reason) {
      setError(String(reason))
    } finally {
      setRunning(false)
    }
  }, [load, onMemoriesChanged, targetScope, targetScopeId])

  const handleRestore = useCallback(
    async (runId: string) => {
      setRestoringId(runId)
      setError(null)
      try {
        await api.dream.restoreRun({ run_id: runId })
        await load()
        onMemoriesChanged()
      } catch (reason) {
        setError(String(reason))
      } finally {
        setRestoringId(null)
      }
    },
    [load, onMemoriesChanged],
  )

  if (!config) return null

  return (
    <div data-slot="memory-dream-panel">
      {error && (
        <Alert tone="danger" shouldAnnounce>
          {error}
        </Alert>
      )}
      <SettingsGroup headingLevel={3} heading={t('settings.memory.dream.title')}>
        <SettingsRow label={t('settings.memory.dream.enabled')} description={t('settings.memory.dream.enabledHint')}>
          <Switch
            aria-label={t('settings.memory.dream.enabled')}
            isSelected={config.enabled}
            onChange={(enabled) => void persistConfig({ ...config, enabled })}
          />
        </SettingsRow>
        <SettingsRow label={t('settings.memory.dream.cooldown')} description={t('settings.memory.dream.cooldownHint')}>
          <NumberField
            aria-label={t('settings.memory.dream.cooldown')}
            minValue={1}
            maxValue={720}
            formatOptions={PLAIN_INTEGER}
            value={draftToNumber(cooldownDraft)}
            onChange={(val) => {
              setCooldownDraft(numberToDraft(val))
              if (Number.isFinite(val) && val >= 1 && val <= 720) {
                void persistConfig({ ...config, cooldown_hours: Math.round(val) })
              }
            }}
          />
        </SettingsRow>
        <SettingsRow label={t('settings.memory.dream.minTurns')} description={t('settings.memory.dream.minTurnsHint')}>
          <NumberField
            aria-label={t('settings.memory.dream.minTurns')}
            minValue={1}
            maxValue={500}
            formatOptions={PLAIN_INTEGER}
            value={draftToNumber(minTurnsDraft)}
            onChange={(val) => {
              setMinTurnsDraft(numberToDraft(val))
              if (Number.isFinite(val) && val >= 1 && val <= 500) {
                void persistConfig({ ...config, min_turns: Math.round(val) })
              }
            }}
          />
        </SettingsRow>
        <SettingsRow label={t('settings.memory.dream.budget')} description={t('settings.memory.dream.budgetHint')}>
          <TextField
            aria-label={t('settings.memory.dream.budget')}
            name="dreamDailyBudget"
            value={budgetDraft}
            onChange={setBudgetDraft}
            onBlur={() => {
              const trimmed = budgetDraft.trim()
              if (!/^\d+(\.\d+)?$/.test(trimmed)) {
                setBudgetDraft(String(config.daily_budget_usd))
                return
              }
              const canonical = trimmed.includes('.') ? trimmed.replace(/\.?0+$/, '') || '0' : trimmed
              void persistConfig({ ...config, daily_budget_usd: decimal(canonical) })
            }}
          />
        </SettingsRow>
        <SettingsRow label={t('settings.memory.dream.runNow')} description={t('settings.memory.dream.runNowHint')}>
          <Button size="sm" variant="secondary" isDisabled={running} onPress={() => void handleRunNow()}>
            {running ? t('settings.memory.dream.running') : t('settings.memory.dream.runAction')}
          </Button>
        </SettingsRow>
        {runs.map((run) => (
          <SettingsRow
            key={run.id}
            label={
              <span className="m-dream-panel__meta">
                <Badge size="sm">{t(`settings.memory.dream.status.${run.status}`)}</Badge>
                <Badge size="sm">{t(`settings.memory.dream.trigger.${run.trigger}`)}</Badge>
                <span>{run.scope_type === 'project' ? run.scope_id : run.scope_type}</span>
              </span>
            }
            description={
              <span className="m-dream-panel__run-summary">
                <span>{run.summary ?? run.error ?? t('settings.memory.dream.noSummary')}</span>
                <span className="m-dream-panel__run-stats">
                  {t('settings.memory.dream.runStats', {
                    turns: run.turns_reviewed,
                    created: run.memories_created,
                    updated: run.memories_updated,
                    pruned: run.memories_pruned,
                    proposals: run.proposals_created,
                  })}
                </span>
              </span>
            }
          >
            {run.pruned_memory_ids.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                isDisabled={restoringId === run.id}
                onPress={() => void handleRestore(run.id)}
              >
                {t('settings.memory.dream.undoPrune')}
              </Button>
            )}
          </SettingsRow>
        ))}
      </SettingsGroup>
    </div>
  )
}
