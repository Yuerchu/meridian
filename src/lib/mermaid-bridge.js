/* global window, document, mermaid */
// Runs inside the Mermaid sandbox (src/lib/mermaid-sandbox.ts), after
// mermaid.min.js has defined the global `mermaid`. Shipped as text — imported
// with `?raw`, never bundled or minified — because the sandbox's CSP admits
// exactly this source by its hash.
//
// The frame is an opaque origin: it cannot read the app, and the app can only
// talk to it with postMessage. The protocol is one shape each way.
//   in:  { id: number, code: string, theme: 'light' | 'dark' }
//   out: { id, svg: string } or { id, error: string }, and once { ready: true }
//
// `securityLevel: 'strict'` is Mermaid's own sanitising. `system-ui` because
// the app shows the result as an image, which cannot load the app's fonts:
// measured and drawn in one installed face, the labels fit their boxes.
;(function () {
  var FONT = 'system-ui, sans-serif'
  var sequence = 0

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return
    var request = event.data
    if (
      !request ||
      typeof request.id !== 'number' ||
      typeof request.code !== 'string' ||
      (request.theme !== 'light' && request.theme !== 'dark')
    ) {
      return
    }
    var id = request.id
    function answer(message) {
      window.parent.postMessage(message, '*')
    }
    try {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: request.theme === 'dark' ? 'dark' : 'default',
        fontFamily: FONT,
        themeVariables: { fontFamily: FONT },
      })
    } catch (error) {
      answer({ id: id, error: String((error && error.message) || error) })
      return
    }
    mermaid
      .render('diagram-' + ++sequence, request.code)
      .then(
        function (result) {
          answer({ id: id, svg: String(result.svg) })
        },
        function (error) {
          answer({ id: id, error: String((error && error.message) || error) })
        },
      )
      .finally(function () {
        // Mermaid lays out in the body and a failed render can leave that
        // behind. Nothing else lives in this document.
        document.body.replaceChildren()
      })
  })

  window.parent.postMessage({ ready: true }, '*')
})()
