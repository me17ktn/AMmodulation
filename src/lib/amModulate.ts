function createEmptyBuffer(
  numberOfChannels: number,
  length: number,
  sampleRate: number,
): AudioBuffer {
  const ctx = new OfflineAudioContext(numberOfChannels, 1, sampleRate)
  return ctx.createBuffer(numberOfChannels, length, sampleRate)
}

function peakAmplitude(buffer: AudioBuffer): number {
  let peak = 0
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch)
    for (let i = 0; i < data.length; i++) {
      const a = Math.abs(data[i])
      if (a > peak) peak = a
    }
  }
  return peak
}

/** y[n] = x[n] * (1 + m * cos(2π f_m n / f_s)). x is peak-normalized. */
export function amModulate(
  source: AudioBuffer,
  depth: number,
  modHz: number,
): AudioBuffer {
  const { sampleRate, length, numberOfChannels } = source
  const out = createEmptyBuffer(numberOfChannels, length, sampleRate)
  const peak = peakAmplitude(source)
  const scale = peak > 0 ? 1 / peak : 1
  const omega = (2 * Math.PI * modHz) / sampleRate

  for (let ch = 0; ch < numberOfChannels; ch++) {
    const x = source.getChannelData(ch)
    const y = out.getChannelData(ch)
    for (let n = 0; n < length; n++) {
      y[n] = x[n] * scale * (1 + depth * Math.cos(omega * n))
    }
  }

  return out
}
