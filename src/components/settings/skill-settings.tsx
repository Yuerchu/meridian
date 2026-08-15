import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, TrashBin, BookOpen, ArrowsRotateRight } from '@gravity-ui/icons'
import { Button, Card, Checkbox, Chip, Description, Disclosure, DisclosureGroup, Input, Label, TextArea, TextField } from '@heroui/react'
import { EmptyState } from '@heroui-pro/react/empty-state'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { api } from '@/api'
import { useConfirm } from '@/hooks/use-confirm'
import { SavedHint, SettingsHeader, SettingsPane } from './primitives'
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
  const [saved, markSaved] = useTemporaryFlag()
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
      markSaved()
      await onSave()
    } catch (e) {
      setError(String(e))
    }
  }

  // No chrome of its own: the caller decides whether this is a card floating on
  // the page or the body of an already-bounded disclosure row.
  return (
    <div data-slot="skill-editor" className="space-y-3">
      {!skill && (
        <TextField fullWidth>
          <Label>{t('settings.skills.dirName')}</Label>
          <Input
            value={dirName}
            onChange={(e) => setDirName(e.target.value)}
            placeholder="my-skill"
            className="font-mono text-xs"
          />
          <Description>{t('settings.skills.dirNameHint')}</Description>
          {dirName.trim().length > 0 && !dirNameValid && (
            <p data-slot="skill-editor-error" className="text-xs text-danger">
              {t('settings.skills.dirNameInvalid')}
            </p>
          )}
        </TextField>
      )}

      <TextField fullWidth>
        <Label>{t('settings.skills.displayName')}</Label>
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={skill?.llm_name ?? dirName}
        />
      </TextField>

      <TextField fullWidth>
        <Label>{t('settings.skills.description')}</Label>
        <TextArea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={isBuiltin}
          rows={2}
          className="resize-none text-xs"
        />
        <Description>{t('settings.skills.descriptionHint')}</Description>
      </TextField>

      <TextField fullWidth>
        <Label>{t('settings.skills.body')}</Label>
        {bodyLoading ? (
          <p data-slot="skill-editor-hint" className="text-xs text-muted">
            {t('common.loading')}
          </p>
        ) : (
          <TextArea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={isBuiltin}
            rows={10}
            className="resize-none font-mono text-xs"
          />
        )}
        <Description>{t('settings.skills.bodyHint')}</Description>
      </TextField>

      {isBuiltin && (
        <p data-slot="skill-editor-builtin-notice" className="text-xs text-info-soft-foreground">
          {t('settings.skills.builtinNotice')}
        </p>
      )}

      {error && (
        <p data-slot="skill-editor-error" className="text-xs text-danger">{error}</p>
      )}

      <div data-slot="skill-editor-actions" className="flex items-center gap-2">
        <Button onClick={handleSave} isDisabled={!canSave}>
          {t('common.save')}
        </Button>
        {saved && (
          <SavedHint data-slot="skill-editor-saved" />
        )}
        {onDelete && !isBuiltin && (
          <Button variant="ghost" className="ml-auto text-danger hover:text-danger" onClick={onDelete}>
            <TrashBin className="w-3.5 h-3.5" />
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
  const { confirm, confirmDialog } = useConfirm()

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
    <SettingsPane>
      <SettingsHeader
        title={t('settings.skills.title')}
        subtitle={t('settings.skills.subtitle')}
        actions={
          <>
            <Button variant="outline" onClick={handleRescan} isDisabled={rescanning}>
              <ArrowsRotateRight className={rescanning ? 'w-3.5 h-3.5 animate-spin' : 'w-3.5 h-3.5'} />
              {t('settings.skills.rescan')}
            </Button>
            <Button variant="outline" onClick={() => setShowCreate(!showCreate)}>
              <Plus className="w-3.5 h-3.5" />
              {t('settings.skills.new')}
            </Button>
          </>
        }
      />

      {error && (
        <p data-slot="skill-settings-error" className="text-xs text-danger">{error}</p>
      )}

      {showCreate && (
        <Card>
          <SkillEditor
            onSave={async () => { setShowCreate(false); await refresh() }}
          />
        </Card>
      )}

      {/* One open at a time is the group's own default (`allowsMultipleExpanded`
          is off), so the single-open rule lives in the primitive rather than in
          the click handler. */}
      <DisclosureGroup
        data-slot="skill-settings-list"
        className="flex flex-col gap-1"
        expandedKeys={expandedDir ? [expandedDir] : []}
        onExpandedChange={(keys) => setExpandedDir((([...keys][0] as string | undefined) ?? null))}
      >
        {skills.map((skill) => {
          const isExpanded = expandedDir === skill.dir_name
          const isBuiltin = skill.is_builtin === 1
          return (
            <Disclosure
              key={skill.dir_name}
              id={skill.dir_name}
              data-slot="skill-item"
              className="flex w-full flex-col overflow-hidden rounded-lg border border-border"
            >
              {/* Wraps on a narrow screen: the two labelled checkboxes take
                  about 130px between them, which left the skill name a couple
                  of characters wide on a phone. */}
              <div data-slot="skill-item-header" className="flex flex-wrap items-center gap-2 pr-3">
                {/* The checkboxes stay outside the trigger: it is a `<button>`,
                    and a nested one would be invalid markup and swallow the
                    click. */}
                <Disclosure.Heading className="min-w-0 flex-1 basis-full md:basis-auto">
                  {/* `flex` is not optional: HeroUI styles the indicator with
                      `ms-auto` and `shrink-0`, which only mean anything inside a
                      flex container. `text-start` undoes the button element's
                      centred UA default. */}
                  <Disclosure.Trigger className="flex w-full items-center gap-2 px-3 py-2 text-start text-xs transition-colors outline-none hover:bg-default/30 focus-visible:bg-default/30">
                    <BookOpen className="w-3.5 h-3.5 shrink-0 text-muted" />
                    {/* The label row absorbs the slack, so the badge and the
                        chevron sit at the right edge without a second auto
                        margin fighting the indicator's own `ms-auto`. */}
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span data-slot="skill-item-name" className="truncate">{skill.display_name}</span>
                      <span data-slot="skill-item-slug" className="font-mono text-muted truncate">
                        {skill.llm_name}
                      </span>
                    </div>
                    <Chip data-slot="skill-item-source" className="shrink-0 text-muted">
                      {t(`settings.skills.source.${skill.source}`)}
                    </Chip>
                    <Disclosure.Indicator className="size-3.5 shrink-0 text-muted" />
                  </Disclosure.Trigger>
                </Disclosure.Heading>
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
              {/* `min-h-0` is load-bearing: the card is a flex column, and a
                  flex item's default `min-height: auto` floors it at its
                  content height. */}
              <Disclosure.Content className="min-h-0 w-full">
                {/* Body, not a plain wrapper: it is what keeps the panel
                    measurable, so without it the editor never collapses. The
                    padding is the editor's own former `p-3`, moved out here now
                    that the row is the only box around it. */}
                <Disclosure.Body data-slot="skill-item-body" className="space-y-2 p-3">
                  {/* A collapsed panel is only hidden, not unmounted, so the
                      editor still has to be gated: mounting one per row would
                      read every skill's file on every visit to this page. */}
                  {isExpanded && (
                    <>
                      <p data-slot="skill-item-description" className="text-xs text-muted">
                        {skill.llm_description}
                      </p>
                      <SkillEditor
                        skill={skill}
                        onSave={refresh}
                        onDelete={isBuiltin ? undefined : async () => {
                          if (!await confirm({ body: t('settings.confirmDelete.skill') })) return
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
                    </>
                  )}
                </Disclosure.Body>
              </Disclosure.Content>
            </Disclosure>
          )
        })}
        {skills.length === 0 && !showCreate && (
          <EmptyState data-slot="skill-settings-empty" size="sm">
            <EmptyState.Header>
              <EmptyState.Title>{t('settings.skills.noSkills')}</EmptyState.Title>
            </EmptyState.Header>
          </EmptyState>
        )}
      </DisclosureGroup>

      <p data-slot="skill-settings-global-hint" className="text-xs text-muted">
        {t('settings.skills.globalBindingHint')}
      </p>
      {confirmDialog}
    </SettingsPane>
  )
}
