import { renderHook } from '@testing-library/react'

import i18n from '@/i18n'
import { useRelativeTime } from './use-relative-time'

describe('useRelativeTime', () => {
  it('formats old dates with the active locale', async () => {
    await i18n.changeLanguage('zh-CN')
    const timestamp = new Date(2024, 0, 2).getTime()
    const { result } = renderHook(() => useRelativeTime())

    expect(result.current(timestamp)).toBe(new Intl.DateTimeFormat('zh-CN').format(timestamp))

    await i18n.changeLanguage('en')
  })
})
