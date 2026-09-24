import { expect, test, type Page } from '@playwright/test'
import {
  THEMES,
  openApp,
  openConversation,
  openSettings,
  parkPointer,
  scrollTranscriptToTop,
  settle,
  type Theme,
} from './fixtures'

/**
 * One screenshot per scene per theme. A scene tagged @narrow also runs in the
 * 390px project; the rest are desktop-only, because below 768px they are the
 * same components in a sheet and add baselines without adding coverage.
 *
 * Conversation titles and labels are the demo fixtures' (`src/dev/demo/`) and
 * the app's zh-CN strings; if a fixture is renamed, the locator here fails
 * loudly rather than photographing the wrong page.
 */

interface Scene {
  name: string
  narrow?: boolean
  /** `false` keeps the approvals and the plan review waiting. */
  quiet?: boolean
  arrange: (page: Page) => Promise<void>
}

const scenes: Scene[] = [
  {
    name: 'welcome',
    narrow: true,
    arrange: async (page) => {
      await expect(page.getByRole('heading', { name: '有什么我可以帮你的？' })).toBeVisible()
    },
  },
  {
    // Bubbles, reasoning, tool blocks, file edits and the usage footer.
    name: 'conversation-rich',
    narrow: true,
    arrange: (page) => openConversation(page, '流式输出时回答写在屏幕外'),
  },
  {
    // The same transcript from its first turn: reasoning, tool blocks, diffs.
    name: 'conversation-rich-top',
    arrange: async (page) => {
      await openConversation(page, '流式输出时回答写在屏幕外')
      await scrollTranscriptToTop(page)
    },
  },
  {
    name: 'conversation-sub-agents',
    arrange: (page) => openConversation(page, 'Android 键盘遮挡输入框'),
  },
  {
    // Stickers on both sides and a `!` command's shell output.
    name: 'conversation-stickers-shell',
    arrange: async (page) => {
      await openConversation(page, '配色和贴纸')
      await scrollTranscriptToTop(page)
    },
  },
  {
    name: 'conversation-compacted',
    arrange: async (page) => {
      await openConversation(page, 'OneBot 引用消息解析')
      // The compaction summary sits above the retained turns.
      await scrollTranscriptToTop(page)
    },
  },
  {
    // A command waiting for approval: the card in the transcript, and the
    // toast for the other conversation's question.
    name: 'approval-command',
    quiet: false,
    arrange: (page) => openConversation(page, 'release 构建体积'),
  },
  {
    // The ask_user form.
    name: 'approval-ask-user',
    quiet: false,
    arrange: (page) => openConversation(page, '设置页导出入口'),
  },
  {
    name: 'inbox',
    quiet: false,
    arrange: async (page) => {
      await page.getByRole('button', { name: /^待处理/ }).click()
      await expect(page.getByRole('dialog', { name: '待处理' })).toBeVisible()
    },
  },
  {
    name: 'composer-menu',
    narrow: true,
    arrange: async (page) => {
      await page.getByRole('button', { name: '选项与附件' }).click()
      await expect(page.getByRole('menu', { name: '选项与附件' })).toBeVisible()
    },
  },
  {
    name: 'command-palette',
    arrange: async (page) => {
      await page.getByRole('button', { name: '搜索与跳转' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
    },
  },
  {
    name: 'rename-dialog',
    arrange: async (page) => {
      await page.getByRole('button', { name: '配色和贴纸 的操作' }).click()
      await page.getByRole('menuitem', { name: '重命名' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByRole('textbox')).toBeFocused()
    },
  },
  {
    // Quiet still keeps the plan waiting for review; it only drops the
    // approval toasts, which would otherwise cover the review's toolbar.
    name: 'plan-review',
    arrange: async (page) => {
      await openConversation(page, '导出功能计划')
      await page.getByRole('button', { name: '审阅计划' }).click()
      await expect(page.getByRole('button', { name: /批准/ }).first()).toBeVisible()
    },
  },
  {
    name: 'settings-general',
    arrange: (page) => openSettings(page, '通用'),
  },
  {
    name: 'settings-providers',
    narrow: true,
    arrange: async (page) => {
      await openSettings(page, '服务商')
      await expect(page.getByRole('button', { name: 'Anthropic' })).toBeVisible()
    },
  },
  {
    name: 'settings-provider',
    narrow: true,
    arrange: async (page) => {
      await openSettings(page, '服务商')
      await page.getByRole('button', { name: 'Anthropic' }).click()
      await expect(page.getByRole('grid', { name: '模型' })).toBeVisible()
    },
  },
  {
    name: 'settings-model',
    arrange: async (page) => {
      await openSettings(page, '服务商')
      await page.getByRole('button', { name: 'Anthropic' }).click()
      await page.getByRole('row', { name: 'claude-sonnet-5', exact: true }).click()
      await expect(page.getByRole('heading', { level: 2, name: 'Claude Sonnet 5' })).toBeVisible()
    },
  },
  {
    name: 'settings-mcp',
    arrange: (page) => openSettings(page, 'MCP 服务器'),
  },
  {
    name: 'settings-mcp-server',
    arrange: async (page) => {
      await openSettings(page, 'MCP 服务器')
      await page.getByRole('button', { name: /^filesystem/ }).click()
      await expect(page.getByRole('button', { name: '返回' })).toBeVisible()
    },
  },
  {
    name: 'settings-memory',
    arrange: (page) => openSettings(page, '记忆'),
  },
  {
    name: 'settings-usage',
    arrange: (page) => openSettings(page, '用量', '用量与消耗'),
  },
  {
    name: 'settings-about',
    arrange: (page) => openSettings(page, '关于'),
  },
]

for (const scene of scenes) {
  for (const theme of THEMES) {
    const tag = scene.narrow ? ['@narrow'] : []
    test(`${scene.name} (${theme})`, { tag }, async ({ page }) => {
      await photograph(page, scene, theme)
    })
  }
}

async function photograph(page: Page, scene: Scene, theme: Theme) {
  await openApp(page, { theme, quiet: scene.quiet ?? true })
  await scene.arrange(page)
  await parkPointer(page)
  await settle(page)
  await expect(page).toHaveScreenshot(`${scene.name}-${theme}.png`)
}
