/** Browser-only microphone source; single-use to keep permission races auditable. */
export class BrowserMicrophone {
  private context: AudioContext | null = null
  private tracks: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private nextFrame = 0
  private stopped = false
  private opening: Promise<void> | null = null

  start(onPcm: (frame: Float32Array) => void): Promise<void> {
    if (this.opening || this.context || this.tracks || this.stopped) {
      return Promise.reject(new Error('Microphone source already started or stopped'))
    }
    const task = this.acquire(onPcm)
    this.opening = task
    void task.finally(() => { if (this.opening === task) this.opening = null }).catch(() => undefined)
    return task
  }
  private async acquire(onPcm: (frame: Float32Array) => void): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true }, video: false,
    })
    if (this.stopped) { stream.getTracks().forEach(track => track.stop()); throw new Error('Microphone stopped') }
    this.tracks = stream
    try {
      const context = new AudioContext()
      this.context = context
      const script = `class MeetingWorklet extends AudioWorkletProcessor {
        process(inputs) {
          const samples = inputs[0] && inputs[0][0]
          if (samples) this.port.postMessage(new Float32Array(samples))
          return true
        }
      }
      registerProcessor('dsh-meeting-capture', MeetingWorklet)`
      const url = URL.createObjectURL(new Blob([script], { type: 'application/javascript' }))
      try { await context.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
      if (this.stopped) throw new Error('Microphone stopped')
      const worklet = new AudioWorkletNode(context, 'dsh-meeting-capture')
      this.node = worklet
      const ratio = context.sampleRate / 16000
      worklet.port.onmessage = event => {
        if (this.stopped) return
        const native = event.data as Float32Array
        const resampled: number[] = []
        let cursor = this.nextFrame
        while (cursor < native.length) {
          resampled.push(native[Math.min(native.length - 1, Math.floor(cursor))]!)
          cursor += ratio
        }
        this.nextFrame = cursor - native.length
        if (resampled.length) onPcm(new Float32Array(resampled))
      }
      this.source = context.createMediaStreamSource(stream)
      this.source.connect(worklet)
      worklet.connect(context.destination)
      await context.resume()
      if (this.stopped) throw new Error('Microphone stopped')
    } catch (error) { await this.stop(); throw error }
  }
  /** Invalidate pending permission grants without waiting for the user to dismiss a prompt. */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.node?.disconnect()
    this.source?.disconnect()
    this.tracks?.getTracks().forEach(track => track.stop())
    this.node = null
    this.source = null
    this.tracks = null
    const context = this.context
    this.context = null
    if (context && context.state !== 'closed') await context.close()
  }
}
