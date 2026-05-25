import { useState } from 'react'
import Chat from './components/Chat'
import Settings from './components/Settings'

type Page = 'chat' | 'settings'

function App() {
  const [page, setPage] = useState<Page>('chat')

  return (
    <div className="flex flex-col h-screen bg-neutral-950 text-neutral-100">
      <header
        className="flex items-center h-12 px-4 border-b border-neutral-800 select-none"
        data-tauri-drag-region
      >
        <h1 className="text-sm font-medium tracking-wide">Meridian</h1>
        <span className="ml-2 text-xs text-neutral-500">v0.1.0-dev</span>
        <nav className="ml-auto flex gap-1">
          <button
            onClick={() => setPage('chat')}
            className={`px-3 py-1 text-xs rounded ${page === 'chat' ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}
          >
            Chat
          </button>
          <button
            onClick={() => setPage('settings')}
            className={`px-3 py-1 text-xs rounded ${page === 'settings' ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-500 hover:text-neutral-300'}`}
          >
            Settings
          </button>
        </nav>
      </header>

      {page === 'chat' ? <Chat /> : <Settings />}
    </div>
  )
}

export default App
