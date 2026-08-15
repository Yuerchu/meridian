import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleCheck, CircleXmark, Play } from '@gravity-ui/icons'
import { Button, Card, Switch } from '@heroui/react'

import { api } from '@/api'
import { useHoldToTalk } from '@/hooks/use-hold-to-talk'
import { usePlatform } from '@/hooks/use-platform'
import { cn } from '@/lib/utils'
import { encodePcm16Base64, openCapture } from '@/lib/web-audio-capture'
import { SettingsHeader, SettingsPane } from './primitives'

/**
 * Microphone capture probe.
 *
 * Android has no native capture path yet; whether it gets one depends on
 * whether the WebView can hand us raw PCM. That question can only be answered
 * on a real device, and running the dev playground there means a vite server,
 * a cable and a shared network — so the probe lives in Settings instead, where
 * a plain release APK can reach it.
 *
 * It stays after the question is settled: the permission plumbing it exercises
 * lives in Tauri's generated `RustWebChromeClient`, which is gitignored and can
 * change under an upgrade without showing up in any diff.
 *
 * Worth turning into a plain "test my microphone" for users at some point —
 * people do not find out their microphone is dead until a recording comes back
 * empty. The checks below already answer that; what would change is the
 * framing: hide the lines about worklets and base64, keep "can it hear you"
 * and the playback, and put the entry point in Voice Input rather than here.
 */

/** The worklet, as source. Loaded through a blob URL rather than a separate
 *  module: the CSP is open, blob URLs inherit the page origin so dev and
 *  packaged builds behave alike, and it needs no bundler configuration. */
const WORKLET_SRC = `
class ProbeProcessor extends AudioWorkletProcessor {
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
    // The peak goes out every block so the meter moves even when discarding;
    // seeing the meter respond is what separates "worklet ran" from
    // "worklet ran and was fed actual audio".
    this.port.postMessage({ peak, samples: this._collecting ? new Float32Array(ch) : null })
    return true
  }
}
registerProcessor('probe', ProbeProcessor)
`

/**
 * The two CSS features Pro's `TextShimmer` needs, asked on the device itself.
 *
 * `#playground/heroui` asks the same question, but only a dev server can reach
 * that — and the answer that matters is Android's, where the WebView ships with
 * the system and an old phone can be years behind. This is why the probe lives
 * in Settings: a plain release APK can open it.
 *
 * What rides on it: if `tan()` is missing, the shimmer's `background` shorthand
 * fails to parse while `-webkit-text-fill-color: transparent` beside it applies
 * regardless. The text does not fall back to plain — it goes invisible. Both
 * green here is what would let `ChainOfThought` move onto Pro's, which pulls
 * `TextShimmer` in with it.
 */
const CSS_PROBES: Array<{ name: string; note: string; test: () => boolean }> = [
  {
    name: 'oklch(from …)',
    note: 'relative color',
    test: () => CSS.supports('color', 'oklch(from red l c h)'),
  },
  {
    name: 'tan()',
    note: 'trig in calc',
    test: () => CSS.supports('width', 'calc(1px * tan(15deg))'),
  },
]

type Verdict = 'pass' | 'fail' | 'pending'

interface Line {
  id: string
  label: string
  verdict: Verdict
  detail?: string
}

function floatToBase64Pcm16(samples: Float32Array): string {
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    pcm[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
  }
  const bytes = new Uint8Array(pcm.buffer)
  // Chunked: String.fromCharCode(...bytes) blows the argument limit somewhere
  // around a few hundred thousand samples, which a 60s recording clears easily.
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function DeveloperSettings() {
  const { t } = useTranslation()
  const isAndroid = usePlatform() === 'android'
  const [holdToTalk, setHoldToTalk] = useHoldToTalk()
  const [lines, setLines] = useState<Line[]>([])
  const [peak, setPeak] = useState(0)
  const [recording, setRecording] = useState(false)
  const [busy, setBusy] = useState(false)

  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const nodeRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null)
  const chunksRef = useRef<Float32Array[]>([])
  const sampleRateRef = useRef(16000)

  const say = useCallback((id: string, label: string, verdict: Verdict, detail?: string) => {
    setLines((prev) => {
      const next = prev.filter((l) => l.id !== id)
      return [...next, { id, label, verdict, detail }]
    })
  }, [])

  /** Every path out of a recording goes through here. A leaked stream leaves
   *  the system microphone indicator lit, which reads as spying. */
  const teardown = useCallback(() => {
    nodeRef.current?.disconnect()
    nodeRef.current = null
    ctxRef.current?.close().catch(() => {})
    ctxRef.current = null
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
    setRecording(false)
    setPeak(0)
  }, [])

  useEffect(() => teardown, [teardown])

  const checkEnvironment = useCallback(() => {
    setLines([])
    say(
      'env',
      t('settings.developer.probe.env'),
      window.isSecureContext && !!navigator.mediaDevices?.getUserMedia ? 'pass' : 'fail',
      `secure=${window.isSecureContext} origin=${location.origin} getUserMedia=${!!navigator.mediaDevices?.getUserMedia}`,
    )
  }, [say, t])

  /** The real path, end to end: capture through the shared module, then the
   *  same command the composer will call. Proves recognition works before any
   *  gesture code exists to reach it. */
  const transcribe = useCallback(async () => {
    setBusy(true)
    setLines([])
    let handle: Awaited<ReturnType<typeof openCapture>> | null = null
    try {
      const t0 = performance.now()
      handle = await openCapture({ onPeak: setPeak })
      say('open', t('settings.developer.probe.open'), 'pass', `${Math.round(performance.now() - t0)} ms`)
      handle.beginCollecting()
      setRecording(true)
      await new Promise((r) => setTimeout(r, 5000))
      const { samples, sampleRate } = handle.stop()
      handle = null
      setRecording(false)

      const t1 = performance.now()
      const result = await api.voiceTranscribePcm(sampleRate, encodePcm16Base64(samples))
      const ms = Math.round(performance.now() - t1)
      say(
        'transcribe',
        t('settings.developer.probe.transcribe'),
        result.status === 'ok' ? 'pass' : 'fail',
        result.status === 'ok' ? `${ms} ms — ${result.text}` : `${result.status} (${ms} ms)`,
      )
    } catch (e) {
      say('error', t('settings.developer.probe.failed'), 'fail', String(e))
    } finally {
      handle?.cancel()
      setRecording(false)
      setPeak(0)
      setBusy(false)
    }
  }, [say, t])

  const record = useCallback(async (useWorklet: boolean) => {
    setBusy(true)
    checkEnvironment()
    chunksRef.current = []
    try {
      const t0 = performance.now()
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      streamRef.current = stream
      const openMs = Math.round(performance.now() - t0)
      // 300ms is the hold threshold the gesture would use as its warm-up
      // window; anything slower means the first word is lost.
      say('open', t('settings.developer.probe.open'), openMs < 300 ? 'pass' : 'fail', `${openMs} ms`)

      const ctx = new AudioContext({ sampleRate: 16000 })
      ctxRef.current = ctx
      sampleRateRef.current = ctx.sampleRate
      say(
        'rate',
        t('settings.developer.probe.rate'),
        'pass',
        `${ctx.sampleRate} Hz${ctx.sampleRate !== 16000 ? ' (resampled by sherpa)' : ''}`,
      )

      const source = ctx.createMediaStreamSource(stream)
      let maxPeak = 0
      const onBlock = (p: number, samples: Float32Array | null) => {
        maxPeak = Math.max(maxPeak, p)
        setPeak(p)
        if (samples) chunksRef.current.push(samples)
      }

      if (useWorklet) {
        const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'text/javascript' }))
        try {
          await ctx.audioWorklet.addModule(url)
        } finally {
          URL.revokeObjectURL(url)
        }
        say('module', t('settings.developer.probe.module'), 'pass')
        const node = new AudioWorkletNode(ctx, 'probe')
        node.port.onmessage = (e) => onBlock(e.data.peak, e.data.samples)
        node.port.postMessage({ collecting: true })
        source.connect(node)
        // Keeps the graph pulling without routing the microphone to the speaker.
        node.connect(ctx.destination)
        nodeRef.current = node
      } else {
        const node = ctx.createScriptProcessor(4096, 1, 1)
        node.onaudioprocess = (e) => {
          const ch = e.inputBuffer.getChannelData(0)
          let p = 0
          for (let i = 0; i < ch.length; i++) p = Math.max(p, Math.abs(ch[i]))
          onBlock(p, new Float32Array(ch))
        }
        source.connect(node)
        node.connect(ctx.destination)
        nodeRef.current = node
        say('module', t('settings.developer.probe.scriptProcessor'), 'pass')
      }

      setRecording(true)
      await new Promise((r) => setTimeout(r, 5000))

      const total = chunksRef.current.reduce((n, c) => n + c.length, 0)
      // A worklet that runs but is fed silence is the exact shape of the bug
      // this probe exists to catch, so "it loaded" is not the question.
      say(
        'audio',
        t('settings.developer.probe.audio'),
        maxPeak > 0.01 && total > 0 ? 'pass' : 'fail',
        `peak=${maxPeak.toFixed(3)} samples=${total}`,
      )

      if (total > 0) {
        const merged = new Float32Array(total)
        let at = 0
        for (const c of chunksRef.current) {
          merged.set(c, at)
          at += c.length
        }
        const encodeStart = performance.now()
        const b64 = floatToBase64Pcm16(merged)
        const encodeMs = Math.round(performance.now() - encodeStart)

        const ipcStart = performance.now()
        try {
          const got = await api.voiceProbeEcho(sampleRateRef.current, b64)
          const ipcMs = Math.round(performance.now() - ipcStart)
          say(
            'ipc',
            t('settings.developer.probe.ipc'),
            got === total ? 'pass' : 'fail',
            `${(b64.length / 1024).toFixed(0)} KB base64 · encode ${encodeMs} ms · ipc ${ipcMs} ms · echoed ${got}/${total}`,
          )
        } catch (e) {
          say('ipc', t('settings.developer.probe.ipc'), 'fail', String(e))
        }

        // Playback is the only unambiguous proof the samples are real audio.
        const play = new AudioContext()
        const buf = play.createBuffer(1, merged.length, sampleRateRef.current)
        buf.copyToChannel(merged, 0)
        const src = play.createBufferSource()
        src.buffer = buf
        src.connect(play.destination)
        src.start()
        src.onended = () => play.close().catch(() => {})
        say('playback', t('settings.developer.probe.playback'), 'pending', t('settings.developer.probe.playbackHint'))
      }
    } catch (e) {
      say('error', t('settings.developer.probe.failed'), 'fail', String(e))
    } finally {
      teardown()
      setBusy(false)
    }
  }, [checkEnvironment, say, t, teardown])

  return (
    <SettingsPane>
      <SettingsHeader
        title={t('settings.developer.title')}
        subtitle={t('settings.developer.intro')}
      />

      {isAndroid && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted">{t('settings.developer.gestures')}</p>
          <Card>
            <Card.Header>
              <Card.Title>{t('settings.developer.holdToTalk')}</Card.Title>
              <Card.Description>{t('settings.developer.holdToTalkHint')}</Card.Description>
            </Card.Header>
            <Card.Footer>
              {/* `Switch.Content` is the clickable element — the root is a
                  plain field wrapper and `Switch.Control` a bare span, so a
                  control parked outside Content has nothing to press. */}
              <Switch isSelected={holdToTalk} onChange={setHoldToTalk}>
                <Switch.Content>
                  <Switch.Control><Switch.Thumb /></Switch.Control>
                  {t('settings.developer.holdToTalkLabel')}
                </Switch.Content>
              </Switch>
            </Card.Footer>
          </Card>
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted">{t('settings.developer.cssProbe')}</p>
        <Card>
          <Card.Header>
            <Card.Title>{t('settings.developer.cssProbeTitle')}</Card.Title>
            <Card.Description>{t('settings.developer.cssProbeHint')}</Card.Description>
          </Card.Header>
          <Card.Content className="gap-1">
            {CSS_PROBES.map((probe) => {
              const ok = probe.test()
              return (
                <div key={probe.name} data-slot="css-probe-line" className="flex items-center gap-2 text-sm">
                  {ok
                    ? <CircleCheck className="size-4 shrink-0 text-success" />
                    : <CircleXmark className="size-4 shrink-0 text-danger" />}
                  <span className="font-mono text-xs">{probe.name}</span>
                  <span className="text-xs text-muted">{probe.note}</span>
                </div>
              )
            })}
          </Card.Content>
        </Card>
      </div>

      <div className="space-y-1.5">
        {/* Names the section, not a control — there is no field under it, only a
            card that titles itself. It was a `<label>` pointing at nothing. */}
        <p className="text-xs font-medium text-muted">{t('settings.developer.micProbe')}</p>
        <Card>
          <Card.Header>
            <Card.Title>{t('settings.developer.micProbeTitle')}</Card.Title>
            <Card.Description>{t('settings.developer.micProbeHint')}</Card.Description>
          </Card.Header>
          <Card.Footer className="gap-2">
            <Button size="sm" onClick={() => record(true)} isDisabled={busy}>
              <Play className="w-4 h-4" />
              {t('settings.developer.probe.runWorklet')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => record(false)} isDisabled={busy}>
              {t('settings.developer.probe.runScriptProcessor')}
            </Button>
            {/* Android only: the desktop transcribes from a Rust-side recording
                session, and reaches it through the composer's own button. */}
            {isAndroid && (
              <Button variant="outline" size="sm" onClick={transcribe} isDisabled={busy}>
                {t('settings.developer.probe.runTranscribe')}
              </Button>
            )}
          </Card.Footer>

          {recording && (
            <div className="space-y-1">
              <p className="text-xs text-danger">{t('settings.developer.probe.speakNow')}</p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-default">
                <div
                  className="h-full bg-success transition-[width] duration-75"
                  style={{ width: `${Math.min(100, peak * 140)}%` }}
                />
              </div>
            </div>
          )}

          {lines.length > 0 && (
            <ul className="space-y-1.5 text-xs">
              {lines.map((l) => (
                <li key={l.id} className="flex items-start gap-2">
                  {l.verdict === 'pass' ? (
                    <CircleCheck className="mt-0.5 w-3.5 h-3.5 shrink-0 text-success" />
                  ) : l.verdict === 'fail' ? (
                    <CircleXmark className="mt-0.5 w-3.5 h-3.5 shrink-0 text-danger" />
                  ) : (
                    <span className="mt-0.5 w-3.5 shrink-0 text-center text-muted">·</span>
                  )}
                  <span className="min-w-0">
                    <span className={cn(l.verdict === 'fail' && 'text-danger')}>{l.label}</span>
                    {l.detail && <span className="ml-1 break-all text-muted">— {l.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </SettingsPane>
  )
}
