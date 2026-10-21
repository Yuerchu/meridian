import { expect, test } from '@playwright/test'
import { THEMES, openApp, openLocalModel, settle } from './fixtures'

for (const theme of THEMES) {
  test(`local model selection and metadata (${theme})`, { tag: ['@narrow'] }, async ({ page }) => {
    await openApp(page, { theme })
    await openLocalModel(page)
    const backend = page.getByRole('button', { name: /文本推理后端/ })
    await backend.scrollIntoViewIfNeeded()
    await settle(page)
    await backend.press('Enter')
    await expect(backend).toHaveAttribute('aria-expanded', 'true')
    await page.getByRole('option', { name: 'GPU', exact: true }).click()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page.getByRole('button', { name: '本地推理', exact: true }).click()
    await expect(page.getByRole('button', { name: /文本推理后端/ })).toContainText('GPU')
    await page.getByRole('button', { name: '检查模型', exact: true }).click()
    await expect(page.getByText('0.18.0', { exact: true })).toBeAttached()
    await page.getByText('默认采样（只读）', { exact: true }).scrollIntoViewIfNeeded()
    await settle(page)
    const sampler = await page.getByText('默认采样（只读）', { exact: true }).boundingBox()
    if (sampler === null) throw new Error('sampler label must exist')
    expect(sampler.width).toBeGreaterThan(100)
  })
}
