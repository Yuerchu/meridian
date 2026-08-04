// Trimmed to the four keys read below by `meridian:trim-icon-manifest` in the
// Vite config; the folder icons it drops are most of the file.
import manifest from 'material-icon-theme/dist/material-icons.json'

/**
 * File icons from the Material Icon Theme, looked up the way VS Code does it.
 *
 * The package itself only ships the tooling that *builds* a VS Code manifest,
 * so the lookup is ours; the manifest it ships alongside is already the flat
 * table that lookup needs, patterns and all expanded into literal names.
 */
interface IconManifest {
  iconDefinitions: Record<string, { iconPath: string }>
  fileExtensions: Record<string, string>
  fileNames: Record<string, string>
  /** Icon id for anything nothing else claims. */
  file: string
}

const { iconDefinitions, fileExtensions, fileNames, file: defaultIcon } =
  manifest as unknown as IconManifest

/**
 * Every icon in the pack as a hashed asset URL.
 *
 * Eager because the alternative is a promise per icon and a frame of nothing
 * where the icon goes; what is eager here is the *URL table*, roughly 1200
 * strings. The SVGs stay on disk until one is actually rendered — which is the
 * only way to cover this: an agent will happily open a `.bin`, and there is no
 * subset of extensions worth guessing at.
 *
 * The pattern has to be a literal — Vite resolves this at build time and cannot
 * follow a variable.
 */
const iconUrls = import.meta.glob<string>(
  '../../node_modules/material-icon-theme/icons/*.svg',
  { query: '?url', import: 'default', eager: true },
)

/** Keyed by bare file name: pnpm resolves the package through a symlink, so the
 *  glob's own keys are not a path this module could reconstruct. */
const urlByFileName: Record<string, string> = {}
for (const [path, url] of Object.entries(iconUrls)) {
  const name = path.split('/').pop()
  if (name) urlByFileName[name] = url
}

function urlFor(iconId: string | undefined): string | undefined {
  if (!iconId) return undefined
  // Clones and coloured variants do not follow `<id>.svg`, so take the name the
  // manifest gives rather than rebuilding it from the id.
  const fileName = iconDefinitions[iconId]?.iconPath.split('/').pop()
  return fileName ? urlByFileName[fileName] : undefined
}

/** The icon for a path, falling back to the pack's generic file icon. */
export function fileIconUrl(filePath: string): string | undefined {
  const name = filePath.split(/[/\\]/).pop()?.toLowerCase()
  if (!name) return urlFor(defaultIcon)

  const exact = urlFor(fileNames[name])
  if (exact) return exact

  // Longest suffix first: `setup.test.ts` should find `test.ts` before `ts`.
  const parts = name.split('.')
  for (let i = 1; i < parts.length; i++) {
    const byExtension = urlFor(fileExtensions[parts.slice(i).join('.')])
    if (byExtension) return byExtension
  }

  return urlFor(defaultIcon)
}
