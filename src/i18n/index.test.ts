import i18n from './index'

describe('document language', () => {
  it('tracks i18next language changes', async () => {
    await i18n.changeLanguage('zh-CN')
    expect(document.documentElement).toHaveAttribute('lang', 'zh-CN')

    await i18n.changeLanguage('en')
    expect(document.documentElement).toHaveAttribute('lang', 'en')
  })
})
