/**
 * The gallery's groups, in the order the design system is read: what
 * everything is made of first, then the primitives, then the product's own
 * compositions. Each is a page of its own at `#playground/<id>`.
 */
export const GROUPS = [
  { id: 'foundations', title: '基础层', description: '颜色、字号、圆角、阴影、渐变、动效，从样式表读出' },
  { id: 'core', title: '基础组件', description: '按钮、标签、头像、卡片、加载' },
  { id: 'forms', title: '表单', description: '输入框、选择、开关、滑块' },
  { id: 'overlays', title: '浮层', description: '菜单、提示、弹出层、对话框、抽屉、通知、命令面板' },
  { id: 'navigation', title: '导航', description: '标签页、分页、侧栏' },
  { id: 'feedback', title: '反馈', description: '提示条、空状态、进度、骨架' },
  { id: 'data', title: '数据', description: '表格、列表、折叠、条目卡' },
  { id: 'charts', title: '图表', description: '指标卡、柱状、排名、环形、热力图、面积图' },
  { id: 'chat', title: '对话', description: '工具块、回合排版、输入框' },
  { id: 'agent', title: '智能体', description: '子 agent、待办、计划模式、改动' },
  { id: 'content', title: '内容', description: 'Markdown、代码、diff、富文本、附件' },
] as const

export type GroupId = (typeof GROUPS)[number]['id']

/** The sub-views that are harnesses rather than galleries. */
export const LABS = [
  { hash: '#playground/scroll', title: '滚动回归', description: '跟随与锚定的全部场景' },
  { hash: '#playground/responsive', title: '断点', description: '在 iframe 里量真实宽度' },
  { hash: '#playground/webview', title: 'WebView 探针', description: '逐项检查 CSS 支持' },
  { hash: '#playground/schema', title: '数据库画布', description: '表与外键' },
  { hash: '#playground/stickers', title: '贴纸', description: '动图暂停与播放' },
] as const
