import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Bin, BookOpen, Plus, RefreshCw } from '@keyline-icons/react/two-tone'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Chip,
  Description,
  Disclosure,
  DisclosureGroup,
  Input,
  Label,
  TextArea,
  TextField,
  Tooltip,
  TooltipTrigger,
} from '@/components/base'
import { EmptyState } from '@/components/base'
import { useTemporaryFlag } from '@/hooks/use-temporary-flag'
import { api } from '@/api'
import { useConfirm } from '@/hooks/use-confirm'
import { SavedHint, SettingsHeader, SettingsPane, SettingsSkeleton } from './primitives'
import type { SkillInfoResponse } from '@/types'

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
    <div data-slot="skill-editor" className="space-y-3">
      {!skill && (
        <TextField>
          <Label>{t('settings.skills.dirName')}</Label>
          <Input
            value={dirName}
            onChange={(e) => setDirName(e.target.value)}
            placeholder="my-skill"
            className="font-mono text-caption-1-regular"
          />
          <Description>{t('settings.skills.dirNameHint')}</Description>
          {dirName.trim().length > 0 && !dirNameValid && (
            <p data-slot="skill-editor-error" className="text-caption-1-regular text-status-danger">
              {t('settings.skills.dirNameInvalid')}
            </p>
          )}
        </TextField>
      )}

      <TextField>
        <Label>{t('settings.skills.displayName')}</Label>
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={skill?.llm_name ?? dirName}
        />
      </TextField>

      <TextField>
        <Label>{t('settings.skills.description')}</Label>
        <TextArea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={skill != null && !contentsEditable}
          rows={2}
          className="resize-none text-caption-1-regular"
        />
        <Description>{t('settings.skills.descriptionHint')}</Description>
      </TextField>

      <TextField>
        <Label>{t('settings.skills.body')}</Label>
        {bodyState === 'loading' ? (
          <p data-slot="skill-editor-hint" className="text-caption-1-regular text-text-secondary">
            {t('common.loading')}
          </p>
        ) : bodyState === 'error' ? (
          <Alert data-slot="skill-editor-body-error" status="danger" role="alert">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{t('settings.skills.bodyLoadError')}</Alert.Title>
              {bodyError && <Alert.Description className="break-all">{bodyError}</Alert.Description>}
              <Button size="small" variant="secondary" onPress={() => setBodyAttempt((n) => n + 1)}>
                {t('common.retry')}
              </Button>
            </Alert.Content>
          </Alert>
        ) : (
          <TextArea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={isBuiltin}
            rows={10}
            className="resize-none font-mono text-caption-1-regular"
          />
        )}
        <Description>{t('settings.skills.bodyHint')}</Description>
      </TextField>

      {isBuiltin && (
        <p data-slot="skill-editor-builtin-notice" className="text-caption-1-regular text-status-info-soft-foreground">
          {t('settings.skills.builtinNotice')}
        </p>
      )}

      {error && (
        <p data-slot="skill-editor-error" className="text-caption-1-regular text-status-danger">
          {error}
        </p>
      )}

      <div data-slot="skill-editor-actions" className="flex items-center gap-2">
        <Button onPress={handleSave} isDisabled={!canSave} isPending={saving}>
          {t('common.save')}
        </Button>
        {saved && <SavedHint data-slot="skill-editor-saved" />}
        {onDelete && !isBuiltin && (
          <TooltipTrigger delay={0}>
            <Button
              iconOnly
              leadingIcon={Bin}
              size="small"
              variant="neutral"
              aria-label={t('settings.skills.delete')}
              className="ml-auto hover:text-status-danger"
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
            <Button leadingIcon={RefreshCw} variant="secondary" onPress={handleRescan} isPending={rescanning}>
              {t('settings.skills.rescan')}
            </Button>
            <Button leadingIcon={Plus} variant="secondary" onPress={() => setShowCreate(!showCreate)}>
              {t('settings.skills.new')}
            </Button>
          </>
        }
      />

      {error && (
        <p data-slot="skill-settings-error" className="text-caption-1-regular text-status-danger">
          {error}
        </p>
      )}

      {showCreate && (
        <Card variant="secondary">
          <SkillEditor
            onSave={async () => {
              setShowCreate(false)
              await refresh()
            }}
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
        onExpandedChange={(keys) => setExpandedDir(([...keys][0] as string | undefined) ?? null)}
      >
        {skills.map((skill) => {
          const isExpanded = expandedDir === skill.dir_name
          const isBuiltin = skill.is_builtin
          return (
            <Disclosure
              key={skill.dir_name}
              id={skill.dir_name}
              data-slot="skill-item"
              className="flex w-full flex-col overflow-hidden rounded-lg border border-border-button-default"
            >
              {/* A container query, not a viewport one. The row wraps when the
                  two labelled checkboxes (about 130px between them) would leave
                  the skill name a couple of characters wide — and that depends
                  on how wide this row is, not on how wide the screen is. Keyed
                  to the viewport it wrapped a 770px-wide card in a window that
                  had merely fallen under the breakpoint. */}
              <div
                data-slot="skill-item-header"
                className="@container/skill-row flex flex-wrap items-center gap-2 pr-3"
              >
                {/* The checkboxes stay outside the trigger: it is a `<button>`,
                    and a nested one would be invalid markup and swallow the
                    click. */}
                {/* `basis-0`, not `basis-auto`: wrapping is decided from the
                    hypothetical size, and shrinking only happens once a line is
                    settled. At `auto` a long skill name counted at full length
                    and pushed the last checkbox onto a line of its own, while a
                    shorter one beside it fit. From 0 the row grows into whatever
                    is left and truncates instead. */}
                <Disclosure.Heading className="min-w-0 flex-1 basis-full @sm/skill-row:basis-0">
                  {/* `flex` is not optional: Disclosure.Indicator carries
                      `shrink-0`, which only means something inside a
                      flex container. `text-start` undoes the button element's
                      centred UA default. */}
                  <Disclosure.Trigger className="flex w-full items-center gap-2 px-3 py-2 text-start text-caption-1-regular transition-colors outline-none hover:bg-background-primary-hover/30 focus-visible:bg-background-secondary-default/30">
                    <BookOpen className="w-3.5 h-3.5 shrink-0 text-text-secondary" />
                    {/* The label row absorbs the slack, so the badge and the
                        chevron sit at the right edge without a separate
                        spacer pushing them there. */}
                    <div data-slot="skill-item-label-row" className="flex min-w-0 flex-1 items-center gap-2">
                      <span data-slot="skill-item-name" className="truncate">
                        {skill.display_name}
                      </span>
                      <span data-slot="skill-item-slug" className="font-mono text-text-secondary truncate">
                        {skill.llm_name}
                      </span>
                    </div>
                    <Chip data-slot="skill-item-source" className="shrink-0 text-text-secondary">
                      {t(`settings.skills.source.${skill.source}`)}
                    </Chip>
                    <Disclosure.Indicator className="size-3.5 shrink-0 text-text-secondary" />
                  </Disclosure.Trigger>
                </Disclosure.Heading>
                <Checkbox
                  data-slot="skill-item-enabled"
                  className="shrink-0 text-caption-1-regular"
                  isSelected={skill.is_enabled}
                  onChange={(selected) => toggleEnabled(skill, selected)}
                >
                  {t('settings.skills.enabled')}
                </Checkbox>
                <Checkbox
                  data-slot="skill-item-global"
                  className="shrink-0 text-caption-1-regular"
                  isSelected={globalBound.has(skill.dir_name)}
                  onChange={(selected) => toggleGlobal(skill.dir_name, selected)}
                >
                  {t('settings.skills.globalBinding')}
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
                      <p data-slot="skill-item-description" className="text-caption-1-regular text-text-secondary">
                        {skill.llm_description}
                      </p>
                      <SkillEditor
                        skill={skill}
                        onSave={refresh}
                        onDelete={
                          isBuiltin
                            ? undefined
                            : async () => {
                                if (!(await confirm({ body: t('settings.confirmDelete.skill') }))) return
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

      <p data-slot="skill-settings-global-hint" className="text-caption-1-regular text-text-secondary">
        {t('settings.skills.globalBindingHint')}
      </p>
      {confirmDialog}
    </SettingsPane>
  )
}
