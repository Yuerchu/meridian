import fs from 'node:fs'
import path from 'path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const host = process.env.TAURI_DEV_HOST
const rootDir = path.dirname(fileURLToPath(import.meta.url))

/**
 * Drops the parts of the Material Icon Theme manifest this app cannot use.
 *
 * It ships 440 kB, of which the folder icons alone are 273 kB — for a file tree
 * Meridian does not have. A JSON import is opaque to tree-shaking (and emitting
 * it as an ES module so it would not be costs more than it saves), so the trim
 * happens at load time instead.
 */
function trimIconManifest(): Plugin {
  const source = 'material-icon-theme/dist/material-icons.json'
  // Redirected to a virtual module rather than trimmed in place: Vite's own
  // JSON plugin claims anything still ending in `.json` and would fight over it.
  const virtualId = '\0meridian:icon-manifest'
  return {
    name: 'meridian:trim-icon-manifest',
    enforce: 'pre',
    resolveId: (id) => (id === source ? virtualId : null),
    load(id) {
      if (id !== virtualId) return null
      const manifest = JSON.parse(fs.readFileSync(path.resolve(rootDir, 'node_modules', source), 'utf8'))
      const { iconDefinitions, fileExtensions, fileNames, file } = manifest
      return `export default ${JSON.stringify({ iconDefinitions, fileExtensions, fileNames, file })}`
    },
  }
}

/**
 * Cuts Shiki's full bundle out of Pro's Markdown.
 *
 * Pro's `Markdown` imports its `CodeBlock` statically, to use as the default
 * `code` component. We always pass our own, so Pro's never renders — but the
 * import still pulls in `shiki`'s full entry point: every grammar it ships as
 * its own chunk, a duplicate of each grammar we load ourselves, and the
 * oniguruma WASM. Roughly 8 MB of unreachable code.
 *
 * The redirect is scoped to imports *from inside* the Pro package, so our own
 * code could still import the real thing if it ever needed to.
 */
function stubProCodeBlock(): Plugin {
  const stub = path.resolve(rootDir, 'src/lib/pro-code-block-stub.ts')
  return {
    name: 'meridian:stub-pro-code-block',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer?.includes('@heroui-pro')) return null
      if (!/(^|\/)code-block(\/index\.js)?$/.test(source.replace(/\.\.?\//g, '/'))) return null
      return stub
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), trimIconManifest(), stubProCodeBlock()],
  clearScreen: false,
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
  build: {
    // Icons are small enough that Vite would inline all ~1200 of them as base64
    // data URLs — over a megabyte of main bundle for a set where a session
    // touches a handful. As files they are fetched on demand, and off the local
    // disk that costs nothing. Everything else keeps the default threshold.
    assetsInlineLimit: (filePath) => (filePath.includes('material-icon-theme') ? false : undefined),
  },
  server: {
    host: host || '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr: host ? { protocol: 'ws', host, port: 5174 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
