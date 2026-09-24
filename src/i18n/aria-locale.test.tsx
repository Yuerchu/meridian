import { act, render, screen } from '@testing-library/react'
import { Button, Input, SearchField, useLocale } from 'react-aria-components'

import i18n from './index'
import { AriaLocaleProvider } from './aria-locale'

function LocaleProbe() {
  const { locale } = useLocale()
  return <output data-testid="locale">{locale}</output>
}

describe('AriaLocaleProvider', () => {
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it("puts React Aria's own strings in the app's language, and follows a switch", async () => {
    await act(() => i18n.changeLanguage('en'))
    render(
      <AriaLocaleProvider>
        <LocaleProbe />
        {/* The clear button's name is written by React Aria, not by us. */}
        <SearchField aria-label="search" defaultValue="x">
          <Input />
          <Button data-testid="clear" />
        </SearchField>
      </AriaLocaleProvider>,
    )
    expect(screen.getByTestId('locale')).toHaveTextContent('en-US')
    const english = screen.getByTestId('clear').getAttribute('aria-label')
    expect(english).toMatch(/clear/i)

    await act(() => i18n.changeLanguage('zh-CN'))
    expect(screen.getByTestId('locale')).toHaveTextContent('zh-CN')
    const chinese = screen.getByTestId('clear').getAttribute('aria-label')
    expect(chinese).not.toBe(english)
    expect(chinese).toMatch(/[一-鿿]/)
  })
})
