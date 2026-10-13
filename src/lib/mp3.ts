import * as lamejs from '@breezystack/lamejs'

const LAME_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]
const BLOCK_SIZE = 1152
const BITRATE = 192

function floatTo16Bit(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff)
  }
  return out
}

function nearestLameRate(rate: number): number {
  let best = LAME_RATES[0]
  let bestDiff = Math.abs(rate - best)
  for (const candidate of LAME_RATES) {
    const diff = Math.abs(rate - candidate)
    if (diff < bestDiff) {
      best = candidate
      bestDiff = diff
    }
  }
  return best
}

async function matchLameSampleRate(buffer: AudioBuffer): Promise<AudioBuffer> {
  const target = nearestLameRate(buffer.sampleRate)
  if (target === buffer.sampleRate) return buffer

  const length = Math.max(1, Math.round(buffer.duration * target))
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, length, target)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.connect(ctx.destination)
  source.start()
  return ctx.startRendering()
}

export async function audioBufferToMp3(buffer: AudioBuffer): Promise<Blob> {
  const pcm = await matchLameSampleRate(buffer)
  const channels = Math.min(2, pcm.numberOfChannels) as 1 | 2
  const encoder = new lamejs.Mp3Encoder(
    channels,
    pcm.sampleRate,
    BITRATE,
  )
  const left = floatTo16Bit(pcm.getChannelData(0))
  const right = channels === 2 ? floatTo16Bit(pcm.getChannelData(1)) : null
  const chunks: BlobPart[] = []

  for (let i = 0; i < left.length; i += BLOCK_SIZE) {
    const end = Math.min(i + BLOCK_SIZE, left.length)
    const encoded =
      channels === 1 || !right
        ? encoder.encodeBuffer(left.subarray(i, end))
        : encoder.encodeBuffer(left.subarray(i, end), right.subarray(i, end))
    if (encoded.length > 0) chunks.push(Uint8Array.from(encoded))
  }

  const flushed = encoder.flush()
  if (flushed.length > 0) chunks.push(Uint8Array.from(flushed))

  return new Blob(chunks, { type: 'audio/mpeg' })
}
