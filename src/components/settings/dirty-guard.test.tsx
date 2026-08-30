import { act, renderHook } from '@testing-library/react'

import {
  clearSettingsTabDirty,
  isSettingsTabDirty,
  setSettingsTabDirty,
  useSettingsDirtyRegistration,
  useSettingsTabDirty,
} from './dirty-guard'

afterEach(() => {
  clearSettingsTabDirty('provider')
})

it('keeps a tab dirty until every independently saved editor is clean', () => {
  setSettingsTabDirty('provider', 'provider-editor', true)
  setSettingsTabDirty('provider', 'model-editor', true)
  expect(isSettingsTabDirty('provider')).toBe(true)

  setSettingsTabDirty('provider', 'provider-editor', false)
  expect(isSettingsTabDirty('provider')).toBe(true)

  setSettingsTabDirty('provider', 'model-editor', false)
  expect(isSettingsTabDirty('provider')).toBe(false)
})

it('updates shell subscribers and unregisters a dirty source on unmount', () => {
  const registration = renderHook(({ dirty }) => useSettingsDirtyRegistration('provider', 'editor', dirty), {
    initialProps: { dirty: false },
  })
  const shell = renderHook(() => useSettingsTabDirty('provider'))
  expect(shell.result.current).toBe(false)

  act(() => registration.rerender({ dirty: true }))
  expect(shell.result.current).toBe(true)

  act(() => registration.unmount())
  expect(shell.result.current).toBe(false)
})
