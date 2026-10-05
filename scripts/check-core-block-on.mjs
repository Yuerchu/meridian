#!/usr/bin/env node
/**
 * meridian-core 的生产代码里不许 `block_on`。
 *
 * core 是框架无关的那一半，跑在别人的 runtime 里：桌面壳的 Tauri runtime、
 * meridiand 自己建的 runtime、测试的 runtime。在里面 `block_on` 一个 future，
 * 要么在 runtime 的 worker 线程上直接 panic，要么把那个线程堵死。同步到异步的
 * 边界只在最外层跨一次——壳的 `setup` 和 meridiand 的 `main` 各一次——core 里
 * 一个都不该有。测试代码不算（`#[cfg(test)]` 模块、`#[test]`/`#[tokio::test]`
 * 函数、`#[cfg(test)] mod x;` 声明的文件），它们自己就是最外层。
 *
 * 用法：node scripts/check-core-block-on.mjs [--staged]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadSources } from './check-transaction-graph.mjs'
import { functions, lineOf } from './transaction-graph-lib.mjs'
import { stagedSnapshot } from './staged-snapshot.mjs'

export function blockOnProblems(files) {
  const problems = []
  for (const file of files) {
    if (file.crate.name !== 'core' || file.wholeTest) continue
    const fns = functions(file.text)
    for (const m of file.text.matchAll(/\bblock_on\s*\(/g)) {
      let owner = null
      for (const fn of fns) {
        if (fn.body[0] < m.index && m.index < fn.body[1] && (!owner || fn.body[0] > owner.body[0])) owner = fn
      }
      if (owner && owner.test) continue
      problems.push(`${file.path}:${lineOf(file.text, m.index)}: core 的生产代码里出现了 block_on`)
    }
  }
  return problems
}

function main() {
  const root = join(fileURLToPath(import.meta.url), '..', '..')
  let read
  let list
  if (process.argv.includes('--staged')) {
    ;({ read, list } = stagedSnapshot(root))
  } else {
    read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : null)
    list = (dir) => {
      const out = []
      const walk = (d) => {
        for (const name of readdirSync(join(root, d))) {
          const p = `${d}/${name}`
          if (statSync(join(root, p)).isDirectory()) walk(p)
          else out.push(p)
        }
      }
      if (existsSync(join(root, dir))) walk(dir)
      return out
    }
  }
  const files = loadSources(read, list)
  if (!files.some((f) => f.crate.name === 'core')) {
    console.error('✗ 没读到 meridian-core 的源码：子模块没初始化，还是路径变了？')
    process.exit(1)
  }
  const problems = blockOnProblems(files)
  if (problems.length) {
    console.error(`✗ ${problems.length} 处 block_on：同步到异步的边界只在壳和 meridiand 的最外层`)
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }
  console.log('✓ core 的生产代码里没有 block_on')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
