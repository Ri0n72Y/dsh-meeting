export const SAMPLE_RATE = 16_000
export function encodeWav(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const tag = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i)
  }
  tag(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); tag(8, 'WAVE')
  tag(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, 1, true); view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true); view.setUint16(32, 2, true)
  view.setUint16(34, 16, true); tag(36, 'data'); view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]!))
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
  }
  return bytes
}
export function decodeWav(bytes: Uint8Array): Float32Array {
  if (bytes.length < 44 || bytes.length % 2 !== 0) throw new Error('Invalid PCM WAV length')
  const text = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (text(0) !== 'RIFF' || text(8) !== 'WAVE' || text(12) !== 'fmt ' || text(36) !== 'data'
    || view.getUint32(4, true) !== bytes.length - 8 || view.getUint32(16, true) !== 16
    || view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1
    || view.getUint32(24, true) !== SAMPLE_RATE || view.getUint16(34, true) !== 16
    || view.getUint32(40, true) !== bytes.length - 44) throw new Error('Expected canonical mono PCM16 16 kHz WAV')
  const samples = new Float32Array((bytes.length - 44) / 2)
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(44 + i * 2, true) / 32768
  return samples
}
