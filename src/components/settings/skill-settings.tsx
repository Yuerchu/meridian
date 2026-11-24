import './skill-settings.css'
import { Checkbox } from '@/components/yuerchu-ui/components/checkbox/checkbox'
import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Bin, BookOpen, ChevronRight, Plus, RefreshCw } from '@keyline-icons/react/two-tone'
import { Button as AriaButton, Disclosure, DisclosureGroup, DisclosurePanel, Heading } from 'react-aria-components'
import { Badge } from '@/components/yuerchu-ui/components/badge/badge'
import { TextField } from '@/components/yuerchu-ui/components/text-field/text-field'
import { TextArea } from '@/components/yuerchu-ui/components/text-area/text-area'
import { Alert } from '@/components/yuerchu-ui/components/alert/alert'
import { Tooltip, TooltipTrigger } from '@/components/yuerchu-ui/components/tooltip/tooltip'
import { Button } from '@/components/yuerchu-ui/components/button/button'
import { EmptyState } from '@/components/yuerchu-ui/components/empty-state/empty-state'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { api } from '@/api'
import { useConfirm } from '@/hooks/use-confirm'
import { SavedHint, SettingsHeader, SettingsPane, SettingsSkeleton } from './primitives'
import { SettingsGroup, SettingsRow } from '@/components/yuerchu-ui/components/settings-list/settings-list'
import type { SkillInfoResponse } from '@/types'
import { titleIfTruncated } from '@/lib/truncation'

/** The directory name doubles as the LLM-facing skill name, so it has to be a
 *  slug. Mirrors the backend's own validation. */
const DIR_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/

function SkillEditor({
  skill,
  onSave,
  onDelete,
}: {
  skill?: SkillInfoResponse
  onSave: () => void | Promise<void>
  onDelete?: () => void
}) {
  const { t } = useTranslation()
  const isBuiltin = skill?.is_builtin ?? false
  const [dirName, setDirName] = useState('')
  const [displayName, setDisplayName] = useState(skill?.display_name ?? '')
  const [description, setDescription] = useState(skill?.llm_description ?? '')
  const [body, setBody] = useState('')
  // `ready` is the only state in which `body` is the file's contents. While
  // loading it is still '' and after a failed read it is '' too, so saving it
  // then would write an empty SKILL.md over the real one.
  const [bodyState, setBodyState] = useState<'loading' | 'ready' | 'error'>(skill != null ? 'loading' : 'ready')
  const [bodyError, setBodyError] = useState<string | null>(null)
  const [bodyAttempt, setBodyAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saved, markSaved] = useTemporaryFlag()
  const [error, setError] = useState<string | null>(null)

  // The body is not part of the index row: it lives in SKILL.md and is read
  // on demand so that listing skills stays a pure database hit.
  const editingDir = skill?.dir_name
  useEffect(() => {
    if (!editingDir) return
    let cancelled = false
    setBodyState('loading')
    setBodyError(null)
    api
      .getSkillBody(editingDir)
      .then((text) => {
        if (cancelled) return
        setBody(text)
        setBodyState('ready')
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setBodyError(String(e))
        setBodyState('error')
      })
    return () => {
      cancelled = true
    }
  }, [editingDir, bodyAttempt])

  // Description and body are written to SKILL.md together, and the backend
  // fills a missing half by reading the file — so neither may be sent until
  // the body we hold is the one on disk.
  const contentsEditable = !isBuiltin && bodyState === 'ready'
  const dirNameValid = DIR_NAME_RE.test(dirName.trim())
  const canSave = skill
    ? displayName.trim().length > 0
    : dirNameValid && description.trim().length > 0 && body.trim().length > 0

  async function handleSave() {
    if (!canSave || saving) return
    setError(null)
    setSaving(true)
    try {
      if (skill) {
        await api.updateSkill({
          dirName: skill.dir_name,
          displayName: displayName.trim(),
          // A built-in skill is regenerated on every launch, so writing its
          // SKILL.md back would be pointless (and the backend rejects it). A
          // body that is not loaded is not sent at all: '' would replace it.
          ...(contentsEditable ? { llmDescription: description.trim(), body } : {}),
        })
      } else {
        await api.createSkill({
          dirName: dirName.trim(),
          llmDescription: description.trim(),
          body,
          displayName: displayName.trim() || null,
        })
      }
      markSaved()
      await onSave()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  // No chrome of its own: the caller decides whether this is a card floating on
  // the page or the body of an already-bounded disclosure row.
  return (
    <div data-slot="skill-editor" className="m-skill__editor">
      <SettingsGroup>
        {!skill && (
          <SettingsRow
            label={t('settings.skills.dirName')}
            description={t('settings.skills.dirNameHint')}
            layout="stacked"
          >
            <TextField
              value={dirName}
              onChange={setDirName}
              placeholder="my-skill"
              isInvalid={dirName.trim().length > 0 && !dirNameValid}
              errorMessage={t('settings.skills.dirNameInvalid')}
            />
          </SettingsRow>
        )}

        <SettingsRow label={t('settings.skills.displayName')} layout="stacked">
          <TextField value={displayName} onChange={setDisplayName} placeholder={skill?.llm_name ?? dirName} />
        </SettingsRow>

        <SettingsRow
          label={t('settings.skills.description')}
          description={t('settings.skills.descriptionHint')}
          layout="stacked"
        >
          <TextArea
            value={description}
            onChange={setDescription}
            isDisabled={skill != null && !contentsEditable}
            rows={2}
          />
        </SettingsRow>

        {/* Loading, failed and loaded are three different things on screen, not
            three fillings of one field. */}
        {bodyState === 'loading' ? (
          <div className="m-skill__body-state">
            <p data-slot="skill-editor-hint" className="m-skill__hint">
              {t('common.loading')}
            </p>
          </div>
        ) : bodyState === 'error' ? (
          <div className="m-skill__body-state">
            <Alert
              data-slot="skill-editor-body-error"
              tone="danger"
              shouldAnnounce
              heading={t('settings.skills.bodyLoadError')}
              actions={
                <Button size="sm" variant="secondary" onPress={() => setBodyAttempt((n) => n + 1)}>
                  {t('common.retry')}
                </Button>
              }
            >
              {bodyError}
            </Alert>
          </div>
        ) : (
          <SettingsRow label={t('settings.skills.body')} description={t('settings.skills.bodyHint')} layout="stacked">
            <TextArea value={body} onChange={setBody} isDisabled={isBuiltin} rows={10} />
          </SettingsRow>
        )}
      </SettingsGroup>

      {isBuiltin && (
        <p data-slot="skill-editor-builtin-notice" className="m-skill__notice">
          {t('settings.skills.builtinNotice')}
        </p>
      )}

      {error && (
        <Alert data-slot="skill-editor-error" tone="danger" shouldAnnounce>
          {error}
        </Alert>
      )}

      <div data-slot="skill-editor-actions" className="m-skill__actions">
        <Button onPress={handleSave} isDisabled={!canSave} isPending={saving}>
          {t('common.save')}
        </Button>
        {saved && <SavedHint data-slot="skill-editor-saved" />}
        {onDelete && !isBuiltin && (
          <TooltipTrigger>
            <Button
              icon={<Bin />}
              size="sm"
              variant="ghost"
              aria-label={t('settings.skills.delete')}
              className="m-skill__aside"
              onPress={onDelete}
            />
            <Tooltip>{t('settings.skills.delete')}</Tooltip>
          </TooltipTrigger>
        )}
      </div>
    </div>
  )
}

export function SkillSettings() {
  const { t } = useTranslation()
  const [skills, setSkills] = useState<SkillInfoResponse[]>([])
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
      api.listSkillBindings({ layer: 'global', anchorId: null }),
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
    async (skill: SkillInfoResponse, enabled: boolean) => {
      setError(null)
      try {
        await api.updateSkill({ dirName: skill.dir_name, isEnabled: enabled })
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
      const next = await api.setSkillBinding({ layer: 'global', anchorId: null, dirName, bound })
      setGlobalBound(new Set(next))
    } catch (e) {
      setError(String(e))
    }
  }, [])

  if (loading) {
    return <SettingsSkeleton data-slot="skill-settings-loading" />
  }

  return (
    <SettingsPane>
      <SettingsHeader
        title={t('settings.skills.title')}
        subtitle={t('settings.skills.subtitle')}
        actions={
          <>
            <Button icon={<RefreshCw />} variant="secondary" onPress={handleRescan} isPending={rescanning}>
              {t('settings.skills.rescan')}
            </Button>
            <Button icon={<Plus />} variant="secondary" onPress={() => setShowCreate(!showCreate)}>
              {t('settings.skills.new')}
            </Button>
          </>
        }
      />

      {error && (
        <Alert data-slot="skill-settings-error" tone="danger" shouldAnnounce>
          {error}
        </Alert>
      )}

      {showCreate && (
        <div className="m-skill__create">
          <SkillEditor
            onSave={async () => {
              setShowCreate(false)
              await refresh()
            }}
          />
        </div>
      )}

      {/* One open at a time is the group's own default (`allowsMultipleExpanded`
          is off), so the single-open rule lives in the primitive rather than in
          the click handler. */}
      <SettingsGroup>
        <DisclosureGroup
          data-slot="skill-settings-list"
          className="m-skill__list"
          expandedKeys={expandedDir ? [expandedDir] : []}
          onExpandedChange={(keys) => setExpandedDir(([...keys][0] as string | undefined) ?? null)}
        >
          {skills.map((skill) => {
            const isExpanded = expandedDir === skill.dir_name
            const isBuiltin = skill.is_builtin
            return (
              <Disclosure key={skill.dir_name} id={skill.dir_name} data-slot="skill-item" className="m-skill__item">
                {/* A container query, not a viewport one. The row wraps when the
                    two labelled checkboxes (about 130px between them) would leave
                    the skill name a couple of characters wide — and that depends
                    on how wide this row is, not on how wide the screen is. Keyed
                    to the viewport it wrapped a 770px-wide card in a window that
                    had merely fallen under the breakpoint. */}
                <div data-slot="skill-item-header" className="m-skill__header">
                  <Heading className="m-skill__heading">
                    <AriaButton slot="trigger" className="m-skill__trigger">
                      <BookOpen size={14} aria-hidden />
                      <span data-slot="skill-item-label-row" className="m-skill__label-row">
                        <span data-slot="skill-item-name" onPointerEnter={titleIfTruncated} className="m-skill__name">
                          {skill.display_name}
                        </span>
                        <span data-slot="skill-item-slug" onPointerEnter={titleIfTruncated} className="m-skill__slug">
                          {skill.llm_name}
                        </span>
                      </span>
                      <Badge data-slot="skill-item-source">{t(`settings.skills.source.${skill.source}`)}</Badge>
                      <ChevronRight size={14} aria-hidden className="m-skill__chevron" />
                    </AriaButton>
                  </Heading>
                  <Checkbox
                    data-slot="skill-item-enabled"
                    isSelected={skill.is_enabled}
                    onChange={(selected) => toggleEnabled(skill, selected)}
                  >
                    {t('settings.skills.enabled')}
                  </Checkbox>
                  <Checkbox
                    data-slot="skill-item-global"
                    isSelected={globalBound.has(skill.dir_name)}
                    onChange={(selected) => toggleGlobal(skill.dir_name, selected)}
                  >
                    {t('settings.skills.globalBinding')}
                  </Checkbox>
                </div>
                {/* `min-h-0` is load-bearing: the card is a flex column, and a
                    flex item's default `min-height: auto` floors it at its
                    content height. */}
                <DisclosurePanel className="m-skill__panel">
                  <div data-slot="skill-item-body" className="m-skill__body">
                    {/* A collapsed panel is only hidden, not unmounted, so the
                        editor still has to be gated: mounting one per row would
                        read every skill's file on every visit to this page. */}
                    {isExpanded && (
                      <>
                        <p data-slot="skill-item-description" className="m-skill__hint">
                          {skill.llm_description}
                        </p>
                        <SkillEditor
                          skill={skill}
                          onSave={refresh}
                          onDelete={
                            isBuiltin
                              ? undefined
                              : async () => {
                                  if (
                                    !(await confirm({
                                      description: t('settings.confirmDelete.skill'),
                                      confirmLabel: t('common.delete'),
                                      tone: 'danger',
                                    }))
                                  )
                                    return
                                  setError(null)
                                  try {
                                    await api.deleteSkill(skill.dir_name)
                                    setExpandedDir(null)
                                    await refresh()
                                  } catch (e) {
                                    setError(String(e))
                                  }
                                }
                          }
                        />
                      </>
                    )}
                  </div>
                </DisclosurePanel>
              </Disclosure>
            )
          })}
          {skills.length === 0 && !showCreate && (
            <EmptyState heading={t('settings.skills.noSkills')} headingLevel={3} size="sm" />
          )}
        </DisclosureGroup>
      </SettingsGroup>

      <p data-slot="skill-settings-global-hint" className="m-skill__hint">
        {t('settings.skills.globalBindingHint')}
      </p>
      {confirmDialog}
    </SettingsPane>
  )
}
