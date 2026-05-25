import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

export default function Settings() {
  const [apiBase, setApiBase] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const base = await invoke<string | null>('get_secret', { key: 'API_BASE' })
        const key = await invoke<string | null>('get_secret', { key: 'API_KEY' })
        const m = await invoke<string | null>('get_secret', { key: 'MODEL' })
        setApiBase(base ?? '')
        setApiKey(key ?? '')
        setModel(m ?? '')
      } catch {
        // first run, no secrets yet
      }
      setLoading(false)
    }
    load()
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    try {
      if (apiBase.trim()) {
        await invoke('set_secret', { key: 'API_BASE', value: apiBase.trim() })
      } else {
        await invoke('delete_secret', { key: 'API_BASE' })
      }
      if (apiKey.trim()) {
        await invoke('set_secret', { key: 'API_KEY', value: apiKey.trim() })
      }
      if (model.trim()) {
        await invoke('set_secret', { key: 'MODEL', value: model.trim() })
      } else {
        await invoke('delete_secret', { key: 'MODEL' })
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      alert(`Failed to save: ${err}`)
    }
  }

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center text-neutral-600 text-sm">
        Loading...
      </main>
    )
  }

  return (
    <main className="flex-1 overflow-y-auto p-6">
      <form onSubmit={handleSave} className="max-w-lg mx-auto space-y-5">
        <h2 className="text-lg font-medium">Provider Settings</h2>

        <div className="space-y-1.5">
          <label className="block text-xs text-neutral-400">API Base URL</label>
          <input
            type="text"
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
            placeholder="https://api.openai.com/v1"
            className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-sm outline-none focus:border-neutral-500 placeholder:text-neutral-600"
          />
          <p className="text-xs text-neutral-600">Leave empty for OpenAI default. Supports any OpenAI-compatible API.</p>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs text-neutral-400">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-sm outline-none focus:border-neutral-500 placeholder:text-neutral-600"
          />
          <p className="text-xs text-neutral-600">Stored encrypted in system keychain (Windows DPAPI / macOS Keychain).</p>
        </div>

        <div className="space-y-1.5">
          <label className="block text-xs text-neutral-400">Model</label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4.1-mini"
            className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-sm outline-none focus:border-neutral-500 placeholder:text-neutral-600"
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="px-4 py-2 bg-neutral-100 text-neutral-900 text-sm font-medium rounded-lg hover:bg-neutral-200"
          >
            Save
          </button>
          {saved && (
            <span className="text-xs text-green-400">Saved successfully</span>
          )}
        </div>
      </form>
    </main>
  )
}
