/**
 * 读「将要提交的东西」——包括子模块里的。
 *
 * `git show :path` 和 `git ls-files --cached` 只认外层索引。`src-tauri/crates`
 * 是 meridian-core 子模块以后,外层索引里那一项是一个 gitlink(mode 160000,
 * 内容是子模块的一个 commit sha),里面的文件在外层索引里根本不存在:三个检查
 * 脚本在 --staged 下读 core 的源码和迁移会全部拿到 null,然后要么当成「没动」
 * 静默通过,要么把一个存在的文件报成缺失。
 *
 * 外层提交固定的是那个 sha,所以「暂存快照」在子模块里的定义就是
 * `git -C <子模块> show <sha>:<相对路径>`——读的是**外层将要指向的那个 commit**,
 * 而不是子模块当前工作树或 HEAD。子模块里提交了、外层还没 `git add` 的改动,
 * 在这里是看不见的,这和它不会进这次提交是一回事。
 */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export function stagedSnapshot(root) {
  const git = (args, cwd = root) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      // git 自己的 fatal 会直接写到终端,盖过脚本要说的话
      stdio: ['ignore', 'pipe', 'ignore'],
    })

  const gitlinks = git(['ls-files', '--stage', '-z'])
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [meta, path] = line.split('\t')
      const [mode, sha] = meta.split(' ')
      return { mode, sha, path }
    })
    .filter((entry) => entry.mode === '160000')

  const submoduleOf = (path) => gitlinks.find((link) => path === link.path || path.startsWith(`${link.path}/`))

  /** 暂存区里这个文件的内容;不在暂存区(未跟踪 / 未暂存 / 已删除)返回 null。 */
  function read(path) {
    const sub = submoduleOf(path)
    try {
      if (!sub) return git(['show', `:${path}`])
      return git(['show', `${sub.sha}:${path.slice(sub.path.length + 1)}`], join(root, sub.path))
    } catch {
      return null
    }
  }

  /** 暂存区里这个目录下的全部文件路径(相对仓库根,正斜杠)。 */
  function list(path) {
    const sub = submoduleOf(path)
    if (!sub) return git(['ls-files', '--cached', '-z', '--', path]).split('\0').filter(Boolean)
    const inner = path.slice(sub.path.length + 1)
    const args = ['ls-tree', '-r', '--name-only', '-z', sub.sha]
    if (inner) args.push('--', inner)
    let out
    try {
      out = git(args, join(root, sub.path))
    } catch {
      throw new Error(
        `子模块 ${sub.path} 里没有外层暂存的 commit ${sub.sha.slice(0, 12)}。` +
          `外层 \`git add ${sub.path}\` 指向的 commit 必须在子模块仓库里存在。`,
      )
    }
    return out
      .split('\0')
      .filter(Boolean)
      .map((file) => `${sub.path}/${file}`)
  }

  return { read, list }
}
