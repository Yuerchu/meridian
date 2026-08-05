import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, ChevronDown, ChevronRight, BookOpen, Check, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@heroui/react'
import { TextArea } from '@heroui/react'
import { Checkbox } from '@heroui/react'
import { api } from '@/api'
import type { Skill } from '@/types'

/** The directory name doubles as the LLM-facing skill name, so it has to be a
 *  slug. Mirrors the backend's own validation. */
const DIR_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

function SkillEditor({
  skill,
  onSave,
  onDelete,
}: {
  skill?: Skill
  onSave: () => void | Promise<void>
  onDelete?: () => void
}) {
  const { t } = useTranslation()
  const isBuiltin = skill?.is_builtin === 1
  const [dirName, setDirName] = useState('')
  const [displayName, setDisplayName] = useState(skill?.display_name ?? '')
  const [description, setDescription] = useState(skill?.llm_description ?? '')
  const [body, setBody] = useState('')
  const [bodyLoading, setBodyLoading] = useState(skill != null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The body is not part of the index row: it lives in SKILL.md and is read
  // on demand so that listing skills stays a pure database hit.
  const editingDir = skill?.dir_name
  useEffect(() => {
    if (!editingDir) return
    let cancelled = false
    setBodyLoading(true)
    api
      .getSkillBody(editingDir)
      .then((text) => { if (!cancelled) setBody(text) })
      .catch(() => { if (!cancelled) setBody('') })
      .finally(() => { if (!cancelled) setBodyLoading(false) })
    return () => { cancelled = true }
  }, [editingDir])

  const dirNameValid = DIR_NAME_RE.test(dirName.trim())
  const canSave = skill
    ? displayName.trim().length > 0
    : dirNameValid && description.trim().length > 0 && body.trim().length > 0

  async function handleSave() {
    if (!canSave) return
    setError(null)
    try {
      if (skill) {
        await api.updateSkill(skill.dir_name, {
          displayName: displayName.trim(),
          // A built-in skill is regenerated on every launch, so writing its
          // SKILL.md back would be pointless (and the backend rejects it).
          ...(isBuiltin ? {} : { llmDescription: description.trim(), body }),
        })
      } else {
        await api.createSkill(
          dirName.trim(),
          description.trim(),
          body,
          displayName.trim() || undefined,
        )
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      await onSave()
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div data-slot="skill-editor" className="space-y-3 p-3 border border-border rounded-lg">
      {!skill && (
        <div data-slot="skill-editor-field" className="space-y-1">
          <label data-slot="skill-editor-label" className="text-xs text-muted">
            {t('settings.skills.dirName')}
          </label>
          <Input fullWidth
            value={dirName}
            onChange={(e) => setDirName(e.target.value)}
            placeholder="my-skill"
            className="font-mono text-xs"
          />
          <p data-slot="skill-editor-hint" className="text-xs text-muted/60">
            {t('settings.skills.dirNameHint')}
          </p>
          {dirName.trim().length > 0 && !dirNameValid && (
            <p data-slot="skill-editor-error" className="text-xs text-danger">
              {t('settings.skills.dirNameInvalid')}
            </p>
          )}
        </div>
      )}

      <div data-slot="skill-editor-field" className="space-y-1">
        <label data-slot="skill-editor-label" className="text-xs text-muted">
          {t('settings.skills.displayName')}
        </label>
        <Input fullWidth
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={skill?.llm_name ?? dirName}
        />
      </div>

      <div data-slot="skill-editor-field" className="space-y-1">
        <label data-slot="skill-editor-label" className="text-xs text-muted">
          {t('settings.skills.description')}
        </label>
        <TextArea fullWidth
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isBuiltin}
          rows={2}
          className="resize-none text-xs"
        />
        <p data-slot="skill-editor-hint" className="text-xs text-muted/60">
          {t('settings.skills.descriptionHint')}
        </p>
      </div>

      <div data-slot="skill-editor-field" className="space-y-1">
        <label data-slot="skill-editor-label" className="text-xs text-muted">
          {t('settings.skills.body')}
        </label>
        {bodyLoading ? (
          <p data-slot="skill-editor-hint" className="text-xs text-muted">
            {t('common.loading')}
          </p>
        ) : (
          <TextArea fullWidth
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={isBuiltin}
            rows={10}
            className="resize-none font-mono text-xs"
          />
        )}
        <p data-slot="skill-editor-hint" className="text-xs text-muted/60">
          {t('settings.skills.bodyHint')}
        </p>
      </div>

      {isBuiltin && (
        <p data-slot="skill-editor-builtin-notice" className="text-xs text-info">
          {t('settings.skills.builtinNotice')}
        </p>
      )}

      {error && (
        <p data-slot="skill-editor-error" className="text-xs text-danger">{error}</p>
      )}

      <div data-slot="skill-editor-actions" className="flex items-center gap-2">
        <Button onClick={handleSave} disabled={!canSave}>
          {t('common.save')}
        </Button>
        {saved && (
          <span data-slot="skill-editor-saved" className="flex items-center gap-1 text-xs text-success">
            <Check className="w-3 h-3" /> {t('common.saved')}
          </span>
        )}
        {onDelete && !isBuiltin && (
          <Button variant="ghost" className="ml-auto text-danger hover:text-danger" onClick={onDelete}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

export function SkillSettings() {
  const { t } = useTranslation()
  const [skills, setSkills] = useState<Skill[]>([])
  const [globalBound, setGlobalBound] = useState<Set<string>>(new Set())
  const [expandedDir, setExpandedDir] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [rescanning, setRescanning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const [list, bound] = await Promise.all([
      api.listSkills(),
      api.listSkillBindings('global'),
    ])
    setSkills(list)
    setGlobalBound(new Set(bound))
  }, [])

  useEffect(() => {
    refresh()
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false))
  }, [refresh])

  const handleRescan = useCallback(async () => {
    setRescanning(true)
    setError(null)
    try {
      await api.rescanSkills()
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setRescanning(false)
    }
  }, [refresh])

  const toggleEnabled = useCallback(
    async (skill: Skill, enabled: boolean) => {
      setError(null)
      try {
        await api.updateSkill(skill.dir_name, { isEnabled: enabled })
        await refresh()
      } catch (e) {
        setError(String(e))
      }
    },
    [refresh],
  )

  const toggleGlobal = useCallback(async (dirName: string, bound: boolean) => {
    setError(null)
    try {
      // The backend caps bindings per anchor, so it is the source of truth for
      // the resulting set rather than a local optimistic update.
      const next = await api.setSkillBinding('global', null, dirName, bound)
      setGlobalBound(new Set(next))
    } catch (e) {
      setError(String(e))
    }
  }, [])

  if (loading) {
    return <div data-slot="skill-settings-loading" className="text-muted text-sm">{t('common.loading')}</div>
  }

  return (
    <div data-slot="skill-settings" className="max-w-lg space-y-6">
      <div data-slot="skill-settings-header" className="flex items-start justify-between gap-2">
        <div data-slot="skill-settings-heading">
          <h2 data-slot="skill-settings-title" className="text-lg font-medium">{t('settings.skills.title')}</h2>
          <p data-slot="skill-settings-subtitle" className="text-xs text-muted mt-1">
            {t('settings.skills.subtitle')}
          </p>
        </div>
        <div data-slot="skill-settings-actions" className="flex items-center gap-1 shrink-0">
          <Button variant="outline" onClick={handleRescan} disabled={rescanning}>
            <RefreshCw className={rescanning ? 'w-3.5 h-3.5 animate-spin' : 'w-3.5 h-3.5'} />
            {t('settings.skills.rescan')}
          </Button>
          <Button variant="outline" onClick={() => setShowCreate(!showCreate)}>
            <Plus className="w-3.5 h-3.5" />
            {t('settings.skills.new')}
          </Button>
        </div>
      </div>

      {error && (
        <p data-slot="skill-settings-error" className="text-xs text-danger">{error}</p>
      )}

      {showCreate && (
        <SkillEditor
          onSave={async () => { setShowCreate(false); await refresh() }}
        />
      )}

      <div data-slot="skill-settings-list" className="space-y-1">
        {skills.map((skill) => {
          const isExpanded = expandedDir === skill.dir_name
          const isBuiltin = skill.is_builtin === 1
          return (
            <div key={skill.dir_name} data-slot="skill-item" className="border border-border rounded-lg overflow-hidden">
              <div data-slot="skill-item-header" className="flex items-center gap-2 pr-3">
                <Button
                  variant="ghost"
                  onClick={() => setExpandedDir(isExpanded ? null : skill.dir_name)}
                  className="flex-1 min-w-0 justify-start h-auto px-3 py-2 text-xs"
                >
                  {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  <BookOpen className="w-3.5 h-3.5 text-muted" />
                  <span data-slot="skill-item-name" className="truncate">{skill.display_name}</span>
                  <span data-slot="skill-item-slug" className="font-mono text-muted/60 truncate">
                    {skill.llm_name}
                  </span>
                  <span data-slot="skill-item-source" className="ml-auto text-xs px-1.5 py-0.5 rounded bg-default text-muted shrink-0">
                    {t(`settings.skills.source.${skill.source}`)}
                  </span>
                </Button>
                <Checkbox
                  data-slot="skill-item-enabled"
                  className="shrink-0 text-xs"
                  isSelected={skill.is_enabled === 1}
                  onChange={(selected) => toggleEnabled(skill, selected)}
                >
                  <Checkbox.Content>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    {t('settings.skills.enabled')}
                  </Checkbox.Content>
                </Checkbox>
                <Checkbox
                  data-slot="skill-item-global"
                  className="shrink-0 text-xs"
                  isSelected={globalBound.has(skill.dir_name)}
                  onChange={(selected) => toggleGlobal(skill.dir_name, selected)}
                >
                  <Checkbox.Content>
                    <Checkbox.Control>
                      <Checkbox.Indicator />
                    </Checkbox.Control>
                    {t('settings.skills.globalBinding')}
                  </Checkbox.Content>
                </Checkbox>
              </div>
              {isExpanded && (
                <div data-slot="skill-item-body" className="px-3 pb-3 space-y-2">
                  <p data-slot="skill-item-description" className="text-xs text-muted">
                    {skill.llm_description}
                  </p>
                  <SkillEditor
                    skill={skill}
                    onSave={refresh}
                    onDelete={isBuiltin ? undefined : async () => {
                      setError(null)
                      try {
                        await api.deleteSkill(skill.dir_name)
                        setExpandedDir(null)
                        await refresh()
                      } catch (e) {
                        setError(String(e))
                      }
                    }}
                  />
                </div>
              )}
            </div>
          )
        })}
        {skills.length === 0 && !showCreate && (
          <p data-slot="skill-settings-empty" className="text-xs text-muted text-center py-4">
            {t('settings.skills.noSkills')}
          </p>
        )}
      </div>

      <p data-slot="skill-settings-global-hint" className="text-xs text-muted/60">
        {t('settings.skills.globalBindingHint')}
      </p>
    </div>
  )
}
