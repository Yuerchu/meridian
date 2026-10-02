import mermaid from 'mermaid'

import { createRenderer } from '@/lib/mermaid-render'

// The entry of mermaid-frame.html. The parent finds this once the frame has
// loaded and hands it one diagram at a time.
window.meridianRenderMermaid = createRenderer(mermaid)
