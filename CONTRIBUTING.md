# 编码规范

规范尽量做成机器可验证的:能被工具管住的都在工具配置里,这份文档只说工具本身
和少数管不住的约定。提交钩子在 `pnpm install` 后自动生效(husky),CI 上同样的
检查再跑一遍,所以绕过钩子的提交也过不了 PR。

## 格式(不用手管)

| 层 | 工具 | 配置 | 强制点 |
|----|------|------|--------|
| 全仓库 | EditorConfig | `.editorconfig`(UTF-8 / LF / 120 列 / TS 2 空格 / Rust 4 空格) | 编辑器 |
| 前端 | Prettier | `.prettierrc`(无分号、单引号、120 列) | pre-commit(lint-staged)+ CI |
| Rust | rustfmt | `src-tauri/rustfmt.toml`(仅 `max_width = 120`,其余默认) | pre-commit + CI |
| 行尾 | git | `.gitattributes` 强制仓库内 LF | checkout/commit |

## Lint

- **前端**:`pnpm lint`。`eslint.config.js` 里除常规规则外,还把 CLAUDE.md 的
  UI 约定编成了规则(禁裸 Tailwind 调色板类、禁 px 字号、禁原生表单元素等),
  违反是 error 不是 warning。
- **Rust**:`cargo clippy --workspace --all-targets -- -D warnings`,CI 强制零警告。
  - 结构性豁免集中在 `Cargo.toml [lints.clippy]`,每条附理由,不散落在代码里。
  - 刻意保留的未接线代码(移植骨架、域完整性 variant)必须挂显式
    `#[allow(dead_code)]` 并写一句为什么留着;没有注解的死代码视为待删除。

## 命名与结构

- Rust:snake_case / CamelCase 由编译器和 clippy 管,不重复约定。
- TS:组件 `PascalCase`,hook 以 `use` 开头,文件名 `kebab-case`,
  类型导出仅在有外部消费者时才 `export`。
- 枚举与字符串的映射用 `strum` derive(`IntoStaticStr` / `EnumString` +
  `serialize_all = "snake_case"`),不手写双向 match 表。

## 提交

- Commit message 遵循 Conventional Commits(`feat:` / `fix:` / `chore(scope):` …),
  `commitlint.config.mjs` 在 commit-msg 钩子里强制。
- 分支命名 `type/description`,单词用 `-` 连接。

## 本地一键自查

```bash
pnpm lint && pnpm format:check && pnpm exec tsc -b && pnpm test
cd src-tauri && cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test
```
