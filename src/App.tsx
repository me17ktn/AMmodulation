import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { amModulate } from './lib/amModulate'
import { audioBufferToMp3 } from './lib/mp3'
import { audioBufferToWav, readWavSampleRate } from './lib/wav'

type Status = 'idle' | 'decoding' | 'processing' | 'ready' | 'error'
type Format = 'mp3' | 'wav'

const DEPTH_MIN = 0
const DEPTH_MAX = 1
const DEPTH_STEP = 0.01
const DEPTH_DEFAULT = 0.1

const FREQ_MIN = 1
const FREQ_MAX = 50
const FREQ_STEP = 1
const FREQ_DEFAULT = 12

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export default function App() {
  const [fileName, setFileName] = useState<string | null>(null)
  const [depth, setDepth] = useState(DEPTH_DEFAULT)
  const [modHz, setModHz] = useState(FREQ_DEFAULT)
  const [format, setFormat] = useState<Format>('mp3')
  const [status, setStatus] = useState<Status>('idle')
  const [message, setMessage] = useState('')
  const [durationSec, setDurationSec] = useState<number | null>(null)
  const [sampleRate, setSampleRate] = useState<number | null>(null)
  const [playing, setPlaying] = useState<'original' | 'modulated' | null>(null)
  const [dragging, setDragging] = useState(false)

  const originalRef = useRef<AudioBuffer | null>(null)
  const modulatedRef = useRef<AudioBuffer | null>(null)
  const downloadUrlRef = useRef<string | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const processingRef = useRef<boolean>(false)

  useEffect(() => {
    return () => {
      sourceRef.current?.stop()
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current)
      void audioCtxRef.current?.close()
    }
  }, [])

  function getAudioContext(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext()
    }
    return audioCtxRef.current
  }

  function stopPlayback() {
    try {
      sourceRef.current?.stop()
    } catch {
      /* already stopped */
    }
    sourceRef.current = null
    setPlaying(null)
  }

  function revokeDownloadUrl() {
    if (downloadUrlRef.current) {
      URL.revokeObjectURL(downloadUrlRef.current)
      downloadUrlRef.current = null
    }
  }

  async function playBuffer(buffer: AudioBuffer, kind: 'original' | 'modulated') {
    stopPlayback()
    const ctx = getAudioContext()
    await ctx.resume()
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.onended = () => {
      if (sourceRef.current === source) {
        sourceRef.current = null
        setPlaying(null)
      }
    }
    sourceRef.current = source
    setPlaying(kind)
    source.start()
  }

  async function loadFile(file: File) {
    stopPlayback()
    modulatedRef.current = null
    revokeDownloadUrl()

    setFileName(file.name)
    setStatus('decoding')
    setMessage('ファイルを読み込んでいます…')

    try {
      const arrayBuffer = await file.arrayBuffer()
      const wavRate = readWavSampleRate(arrayBuffer)
      const decodeCtx = wavRate
        ? new OfflineAudioContext(1, 1, wavRate)
        : getAudioContext()
      const decoded = await decodeCtx.decodeAudioData(arrayBuffer.slice(0))
      originalRef.current = decoded
      setDurationSec(decoded.duration)
      setSampleRate(decoded.sampleRate)
      setStatus('idle')
      setMessage('')
    } catch {
      originalRef.current = null
      setStatus('error')
      setMessage('このファイルはデコードできませんでした。WAV / MP3 / OGG などを指定してください。')
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    void loadFile(file)
  }

  function clearFile() {
    stopPlayback()
    originalRef.current = null
    modulatedRef.current = null
    revokeDownloadUrl()
    if (fileInputRef.current) fileInputRef.current.value = ''
    setFileName(null)
    setDurationSec(null)
    setSampleRate(null)
    setStatus('idle')
    setMessage('')
  }

  function onDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    if (!busy) setDragging(true)
  }

  function onDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    if (busy) return
    const file = event.dataTransfer.files[0]
    if (!file) return
    if (fileInputRef.current) {
      const dt = new DataTransfer()
      dt.items.add(file)
      fileInputRef.current.files = dt.files
    }
    void loadFile(file)
  }

  async function publishOutput(buffer: AudioBuffer, nextFormat: Format) {
    revokeDownloadUrl()
    const blob =
      nextFormat === 'mp3' ? await audioBufferToMp3(buffer) : audioBufferToWav(buffer)
    downloadUrlRef.current = URL.createObjectURL(blob)
  }

  async function process() {
    if (processingRef.current) return

    const original = originalRef.current
    if (!original) {
      setStatus('error')
      setMessage('先に楽曲ファイルを選んでください。')
      return
    }
    if (!Number.isFinite(depth) || depth < DEPTH_MIN || depth > DEPTH_MAX) {
      setStatus('error')
      setMessage(`変調深度は ${DEPTH_MIN}〜${DEPTH_MAX} にしてください。`)
      return
    }
    if (!Number.isFinite(modHz) || modHz < FREQ_MIN || modHz > FREQ_MAX) {
      setStatus('error')
      setMessage(`変調周波数は ${FREQ_MIN}〜${FREQ_MAX} Hz にしてください。`)
      return
    }

    processingRef.current = true
    stopPlayback()
    setStatus('processing')
    setMessage('AM変調しています…')

    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    try {
      const modulated = amModulate(original, depth, modHz)
      modulatedRef.current = modulated
      await publishOutput(modulated, format)
      setStatus('ready')
      setMessage(
        `変調が完了しました。再生または ${format.toUpperCase()} を保存できます。`,
      )
    } catch (error) {
      setStatus('error')
      setMessage('変調処理に失敗しました。')
      console.log(error)
    } finally {
      processingRef.current = false
    }
  }

  async function onFormatChange(next: Format) {
    setFormat(next)
    if (status !== 'ready' || !modulatedRef.current) return
    try {
      await publishOutput(modulatedRef.current, next)
      setMessage(`保存形式を ${next.toUpperCase()} に切り替えました。`)
    } catch {
      setStatus('error')
      setMessage('保存データの作成に失敗しました。')
    }
  }

  function downloadName(): string {
    const base = (fileName ?? 'audio').replace(/\.[^.]+$/, '')
    const ext = format === 'mp3' ? 'mp3' : 'wav'
    return `${base}_m${depth}_f${modHz}Hz.${ext}`
  }

  const busy = status === 'decoding' || status === 'processing'
  const canProcess = Boolean(originalRef.current) && !busy
  const canUseOutput = status === 'ready' && Boolean(modulatedRef.current)

  const busyMessage =
  status === 'decoding'
    ? '楽曲ファイルを読み込んでいます…'
    : status === 'processing'
      ? format === 'mp3'
        ? 'AM変調とMP3エンコードを実行しています…'
        : 'AM変調とWAV生成を実行しています…'
      : ''

  return (
    <div className="min-h-svh bg-zinc-950 text-zinc-100">
      <main className="mx-auto flex max-w-xl flex-col gap-8 px-6 py-12">
        <header className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">AM変調</h1>
          <p className="text-sm leading-relaxed text-zinc-400">
            楽曲指定した変調深度と変調周波数で AM 変調します。
          </p>
        </header>

        <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">楽曲ファイル</span>

<label
  onDragOver={onDragOver}
  onDragLeave={onDragLeave}
  onDrop={onDrop}
  className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-5 py-8 text-center transition-all duration-200 ${
    busy
      ? 'pointer-events-none cursor-not-allowed opacity-50'
      : 'cursor-pointer'
  } ${
    dragging
      ? 'border-emerald-400 bg-emerald-950/50'
      : fileName
        ? 'border-emerald-500 bg-emerald-950/30'
        : 'border-zinc-600 bg-zinc-900 hover:border-zinc-400 hover:bg-zinc-800'
  }`}
>
  <input
    ref={fileInputRef}
    type="file"
    accept="audio/*"
    disabled={busy}
    onChange={onFileChange}
    className="sr-only"
  />

  {fileName ? (
    <>
      {/* 選択済みアイコン */}
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="30"
          height="30"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </div>

      <div className="w-full max-w-full space-y-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-400">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m5 12 4 4L19 6" />
          </svg>
          ファイル選択済み
        </span>

        <p
          className="break-all text-base font-semibold text-zinc-100"
          title={fileName}
        >
          {fileName}
        </p>

        {durationSec != null && sampleRate != null && (
          <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-zinc-400">
            <span className="rounded-md bg-zinc-800 px-2.5 py-1">
              {durationSec.toFixed(1)} 秒
            </span>
            <span className="rounded-md bg-zinc-800 px-2.5 py-1">
              {(sampleRate / 1000).toFixed(1)} kHz
            </span>
          </div>
        )}
      </div>

      <span className="text-xs text-emerald-400/80">
        クリックまたはドラッグ＆ドロップで変更
      </span>
    </>
  ) : (
    <>
      {/* 未選択アイコン */}
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800 text-zinc-400">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="30"
          height="30"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 16V4" />
          <path d="m7 9 5-5 5 5" />
          <path d="M20 16.5v2A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5v-2" />
        </svg>
      </div>

      <div className="space-y-1">
        <p className="text-base font-semibold text-zinc-100">
          {dragging
            ? 'ここにドロップ'
            : '楽曲ファイルを選択'}
        </p>
        <p className="text-sm text-zinc-400">
          クリックまたはドラッグ＆ドロップ
        </p>
      </div>

      <span className="rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400">
        WAV / MP3 / OGG など
      </span>
    </>
  )}
</label>

{fileName && (
  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/70 px-4 py-3">
    <div className="flex min-w-0 items-center gap-2">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0 text-emerald-400"
        aria-hidden="true"
      >
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>

      <span className="min-w-0 break-all text-sm font-medium text-zinc-200">
        {fileName}
      </span>
    </div>

    <button
      type="button"
      disabled={busy}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        clearFile();
      }}
      className="shrink-0 rounded-md border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-300 transition-colors hover:border-red-500/50 hover:bg-red-500/10 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
    >
      選択解除
    </button>
  </div>
)}
        </div>

        <div className="grid gap-6">
          <label className="flex flex-col gap-2">
            <span className="flex items-center justify-between text-sm font-medium">
              変調深度 m
              <input
                type="number"
                min={DEPTH_MIN}
                max={DEPTH_MAX}
                step={DEPTH_STEP}
                value={depth}
                disabled={busy}
                onChange={(e) => setDepth(clamp(Number(e.target.value), DEPTH_MIN, DEPTH_MAX))}
                className="w-24 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-right text-sm outline-none focus:border-emerald-500"
              />
            </span>
            <input
              type="range"
              min={DEPTH_MIN}
              max={DEPTH_MAX}
              step={DEPTH_STEP}
              value={depth}
              disabled={busy}
              onChange={(e) => setDepth(Number(e.target.value))}
              className="accent-emerald-500"
            />
            <span className="text-xs text-zinc-500">
              {DEPTH_MIN} 〜 {DEPTH_MAX}
            </span>
          </label>
          <label className="flex flex-col gap-2">
            <span className="flex items-center justify-between text-sm font-medium">
              変調周波数 f[Hz]
              <input
                type="number"
                min={FREQ_MIN}
                max={FREQ_MAX}
                step={FREQ_STEP}
                value={modHz}
                disabled={busy}
                onChange={(e) => setModHz(clamp(Number(e.target.value), FREQ_MIN, FREQ_MAX))}
                className="w-24 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-right text-sm outline-none focus:border-emerald-500"
              />
            </span>
            <input
              type="range"
              min={FREQ_MIN}
              max={FREQ_MAX}
              step={FREQ_STEP}
              value={modHz}
              disabled={busy}
              onChange={(e) => setModHz(Number(e.target.value))}
              className="accent-emerald-500"
            />
            <span className="text-xs text-zinc-500">
              {FREQ_MIN} 〜 {FREQ_MAX} Hz
            </span>
          </label>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">保存形式</span>
          <select
            value={format}
            disabled={busy}
            onChange={(e) => void onFormatChange(e.target.value as Format)}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
          >
            <option value="mp3">MP3</option>
            <option value="wav">WAV</option>
          </select>
        </label>

        <button
          type="button"
          disabled={!canProcess}
          onClick={() => void process()}
          className="rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
        >
          {busy && status === 'processing' && (
            <svg
              className="h-4 w-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <circle
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                className="opacity-25"
              />
              <path
                d="M4 12a8 8 0 018-8"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinecap="round"
              />
            </svg>
          )}
          {status === 'processing'
            ? '変調処理中…'
            : status === 'decoding'
              ? '読み込み中…'
              : 'AM変調する'}
        </button>

        {busy && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-4"
          >
            <div className="flex items-center gap-3">
              <svg
                className="h-6 w-6 shrink-0 animate-spin text-emerald-400"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-90"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-emerald-300">
                  {busyMessage}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  音声の長さによって時間がかかる場合があります。
                  このままお待ちください。
                </p>
              </div>
            </div>

            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full w-1/3 animate-pulse rounded-full bg-emerald-400" />
            </div>
          </div>
        )}

        {message && (
          <p
            className={`text-sm ${status === 'error' ? 'text-red-400' : 'text-zinc-400'}`}
          >
            {message}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={!originalRef.current || busy}
            onClick={() => {
              if (playing === 'original') stopPlayback()
              else if (originalRef.current) void playBuffer(originalRef.current, 'original')
            }}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {playing === 'original' ? '原音を停止' : '原音を再生'}
          </button>
          <button
            type="button"
            disabled={!canUseOutput || busy}
            onClick={() => {
              if (playing === 'modulated') stopPlayback()
              else if (modulatedRef.current)
                void playBuffer(modulatedRef.current, 'modulated')
            }}
            className="rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {playing === 'modulated' ? '変調音を停止' : '変調音を再生'}
          </button>
          <a
            href={canUseOutput && !busy ? (downloadUrlRef.current ?? undefined) : undefined}
            download={downloadName()}
            aria-disabled={!canUseOutput}
            className={`rounded-md px-3 py-2 text-sm ${
              canUseOutput
                ? 'bg-zinc-100 text-zinc-900 hover:bg-white'
                : 'pointer-events-none bg-zinc-800 text-zinc-500'
            }`}
          >
            {format.toUpperCase()}を保存
          </a>
        </div>
      </main>
    </div>
  )
}
