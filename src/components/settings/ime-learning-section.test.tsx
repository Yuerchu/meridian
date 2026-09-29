import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { api } from '@/api'
import i18n from '@/i18n'
import type { ImeLearningInfoResponse } from '@/types'
import { ImeLearningSection } from './ime-learning-section'

vi.mock('@/api', () => ({
  api: {
    getImeLearning: vi.fn(),
    forgetImeLearnedWord: vi.fn(),
    forgetAllImeLearning: vi.fn(),
  },
}))

const mockApi = vi.mocked(api)

const learned: ImeLearningInfoResponse = {
  words: [
    { text: '你好', count: 12, user_word: false },
    { text: '香港', count: 3, user_word: true },
    { text: '中国队', count: 0, user_word: true },
  ],
  transitions: 7,
  pending: 0,
}

const after = (drop: string, pending = 1): ImeLearningInfoResponse => ({
  ...learned,
  words: learned.words.filter((w) => w.text !== drop),
  pending,
})

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN')
  vi.clearAllMocks()
  mockApi.getImeLearning.mockResolvedValue(learned)
})

async function openList() {
  const user = userEvent.setup()
  render(<ImeLearningSection />)
  await user.click(await screen.findByRole('button', { name: i18n.t('settings.ime.learned.manage') }))
  return user
}

describe('ImeLearningSection', () => {
  it('says how much was learned before anything is opened', async () => {
    render(<ImeLearningSection />)
    expect(
      await screen.findByText(i18n.t('settings.ime.learned.summary', { words: 3, transitions: 7 })),
    ).toBeInTheDocument()
    expect(screen.queryByText('你好')).toBeNull()
  })

  it('lists the words with the ones composed marked, and narrows them by search', async () => {
    const user = await openList()
    expect(screen.getByText('你好')).toBeInTheDocument()
    expect(screen.getAllByText(i18n.t('settings.ime.learned.userWord'))).toHaveLength(2)
    await user.type(screen.getByRole('searchbox', { name: i18n.t('settings.ime.learned.search') }), '香')
    expect(screen.queryByText('你好')).toBeNull()
    expect(screen.getByText('香港')).toBeInTheDocument()
  })

  it('forgets one word and says the keyboard finishes it later', async () => {
    mockApi.forgetImeLearnedWord.mockResolvedValue(after('香港'))
    const user = await openList()
    await user.click(screen.getByRole('button', { name: i18n.t('settings.ime.learned.forget', { word: '香港' }) }))
    expect(mockApi.forgetImeLearnedWord).toHaveBeenCalledWith({ text: '香港' })
    await waitFor(() => expect(screen.queryByText('香港')).toBeNull())
    expect(screen.getByText(i18n.t('settings.ime.learned.pending'))).toBeInTheDocument()
  })

  it('forgets everything only after it is confirmed', async () => {
    mockApi.forgetAllImeLearning.mockResolvedValue({ words: [], transitions: 0, pending: 1 })
    const user = await openList()
    await user.click(screen.getByRole('button', { name: i18n.t('settings.ime.learned.forgetAll') }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(i18n.t('settings.ime.learned.forgetAllConfirm'))).toBeInTheDocument()
    expect(mockApi.forgetAllImeLearning).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: i18n.t('common.confirm') }))
    await waitFor(() => expect(mockApi.forgetAllImeLearning).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText('你好')).toBeNull())
  })

  it('offers nothing to manage when nothing was learned', async () => {
    mockApi.getImeLearning.mockResolvedValue({ words: [], transitions: 0, pending: 0 })
    render(<ImeLearningSection />)
    expect(
      await screen.findByText(i18n.t('settings.ime.learned.summary', { words: 0, transitions: 0 })),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: i18n.t('settings.ime.learned.manage') })).toBeNull()
  })
})
