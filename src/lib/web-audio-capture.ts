/**
 * Microphone capture inside the WebView.
 *
 * This is Android's capture path. The desktop records in Rust through cpal;
 * here the samples are collected in the page and posted over as base64, because
 * Android has no raw IPC — `InvokeBody::Raw` is unsupported there and an
 * `ArrayBuffer` argument arrives expanded into a JSON number array.
 *
 * Everything downstream is shared: the same engine, filter and prompt handling
 * as the desktop, entered through `voice_transcribe_pcm` instead of a recording
 * session.
 */

/** The worklet, as source. Loaded through a blob URL rather than a separate
 *  module: the CSP is open, blob URLs inherit the page origin so dev and
 *  packaged builds behave alike, and it needs no bundler configuration. */
const WORKLET_SRC = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._collecting = false
    this.port.onmessage = (e) => { this._collecting = e.data.collecting }
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (!ch) return true
    let peak = 0
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i] < 0 ? -ch[i] : ch[i]
      if (v > peak) peak = v
    }
    this.port.postMessage({ peak, samples: this._collecting ? new Float32Array(ch) : null })
    return true
  }
}
registerProcessor('meridian-capture', CaptureProcessor)
`

export interface CaptureHandle {
  /** Begin keeping samples. Before this the graph runs and its output is
   *  discarded, which is what lets the device open ahead of the decision to
   *  record without the pre-roll ending up in the transcript. */
  beginCollecting(): void
  /** Stop, release the device, and return what was collected. */
  stop(): { samples: Float32Array; sampleRate: number }
  /** Release without returning anything. Safe to call twice. */
  cancel(): void
  readonly sampleRate: number
}

export interface CaptureOptions {
  /** Called every audio block with the current peak, for a level meter. */
  onPeak?: (peak: number) => void
}

/**
 * Open the microphone and start a discarded pre-roll.
 *
 * Slow and unpredictable: 200ms on a good run and 2.6s on a bad one, measured
 * on one device within a single minute. Callers must not assume a fixed warm-up
 * window is enough.
 */
export async function openCapture(opts: CaptureOptions = {}): Promise<CaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  })

  let ctx: AudioContext
  try {
    // Asking for 16k matches what the recogniser wants and, on the devices
    // tested, is honoured — but sherpa resamples anyway, so a refusal is not
    // fatal and the real rate is what gets reported.
    ctx = new AudioContext({ sampleRate: 16000 })
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop())
    throw e
  }

  const chunks: Float32Array[] = []
  let collecting = false
  let released = false

  const release = () => {
    if (released) return
    released = true
    node?.disconnect()
    source.disconnect()
    ctx.close().catch(() => {})
    stream.getTracks().forEach((t) => t.stop())
  }

  let node: AudioWorkletNode | ScriptProcessorNode | null = null
  let source: MediaStreamAudioSourceNode

  try {
    source = ctx.createMediaStreamSource(stream)
    const onBlock = (peak: number, samples: Float32Array | null) => {
      opts.onPeak?.(peak)
      if (samples && collecting) chunks.push(samples)
    }

    try {
      const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'text/javascript' }))
      try {
        await ctx.audioWorklet.addModule(url)
      } finally {
        URL.revokeObjectURL(url)
      }
      const worklet = new AudioWorkletNode(ctx, 'meridian-capture')
      worklet.port.onmessage = (e) => onBlock(e.data.peak, e.data.samples)
      worklet.port.postMessage({ collecting: true })
      node = worklet
    } catch {
      // Deprecated, runs on the main thread, and works where the worklet does
      // not. Recording at all beats recording well.
      const legacy = ctx.createScriptProcessor(4096, 1, 1)
      legacy.onaudioprocess = (e) => {
        const ch = e.inputBuffer.getChannelData(0)
        let peak = 0
        for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]))
        onBlock(peak, new Float32Array(ch))
      }
      node = legacy
    }

    source.connect(node)
    // Keeps the graph pulling. The processor emits nothing, so this does not
    // route the microphone back to the speaker.
    node.connect(ctx.destination)
  } catch (e) {
    release()
    throw e
  }

  return {
    sampleRate: ctx.sampleRate,
    beginCollecting() {
      collecting = true
      chunks.length = 0
    },
    stop() {
      collecting = false
      const total = chunks.reduce((n, c) => n + c.length, 0)
      const samples = new Float32Array(total)
      let at = 0
      for (const c of chunks) {
        samples.set(c, at)
        at += c.length
      }
      release()
      return { samples, sampleRate: ctx.sampleRate }
    },
    cancel: release,
  }
}

/**
 * Encode float samples as base64 16-bit PCM, the form `voice_transcribe_pcm`
 * expects. i16 halves the payload against f32 at no cost the recogniser can
 * hear.
 */
export function encodePcm16Base64(samples: Float32Array): string {
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
  }
  const bytes = new Uint8Array(pcm.buffer)
  // Chunked: spreading a whole recording into String.fromCharCode blows the
  // argument limit somewhere around a few hundred thousand samples.
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
