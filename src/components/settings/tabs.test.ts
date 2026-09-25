import { settingsTabGroups, settingsTabIds, visibleSettingsTabGroups, visibleSettingsTabs } from './tabs'

vi.mock('@/lib/capabilities', () => ({ can: { manageServers: true } }))
vi.mock('@/lib/transport', () => ({ isRemote: false }))

/**
 * The groups are the one order. Every other consumer — the sidebar, the command
 * palette, the composer's typeahead — reads a flat list derived from them, so a
 * tab that slipped out of every group would vanish from all three at once, and
 * one listed twice would appear twice in the palette.
 */
describe('settings tab groups', () => {
  it('places every tab in exactly one group', () => {
    const grouped = settingsTabGroups.flatMap((group) => group.tabs)
    // Against the definition table, not against the derived flat list: that
    // one is built from the groups, so comparing the two would agree with
    // itself however many tabs had been dropped.
    expect([...grouped].sort()).toEqual([...settingsTabIds].sort())
    expect(new Set(grouped).size).toBe(grouped.length)
  })

  it('derives the flat order from the groups', () => {
    const grouped = settingsTabGroups.flatMap((group) => group.tabs)
    expect(visibleSettingsTabs(null).map((tab) => tab.id)).toEqual(grouped)
  })

  /**
   * A heading over nothing reads as something that failed to load, and on a
   * standalone Android build that is most of Integrations.
   */
  it('drops a group whose every tab is hidden, and keeps a thinned one', () => {
    const groups = visibleSettingsTabGroups('android')
    const ids = groups.flatMap(({ tabs }) => tabs.map((tab) => tab.id))
    expect(ids).not.toContain('onebot')
    expect(ids).not.toContain('hooks')
    expect(ids).not.toContain('acp')
    expect(ids).not.toContain('remote')
    expect(ids).not.toContain('voiceCorpus')
    // Voice survives: recording happens in the WebView, and the model has to be
    // downloaded from that panel before anything can be transcribed.
    expect(ids).toContain('voice')
    expect(groups.every(({ tabs }) => tabs.length > 0)).toBe(true)
  })

  it('shows the input method where there is one: Windows and Android', () => {
    const ids = (platform: string) => visibleSettingsTabGroups(platform).flatMap(({ tabs }) => tabs.map((t) => t.id))
    expect(ids('windows')).toContain('ime')
    expect(ids('android')).toContain('ime')
    expect(ids('linux')).not.toContain('ime')
    expect(ids('macos')).not.toContain('ime')
  })

  it('shows every group on a desktop', () => {
    const groups = visibleSettingsTabGroups('windows')
    expect(groups.map(({ group }) => group.id)).toEqual(['models', 'agent', 'integrations', 'app'])
  })
})
