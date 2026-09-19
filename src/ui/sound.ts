/**
 * 极小的程序化音效层：全部 Web Audio 合成，零音频素材、零版权问题。
 * 只三种声音：窑火（带通噪声，随热度变亮）、磬（珍品揭示）、裂（废品炸响）。
 */

let ctx: AudioContext | null = null
let fireGain: GainNode | null = null
let fireSource: AudioBufferSourceNode | null = null

function audio(): AudioContext {
  if (ctx === null) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = new Ctor()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate)
  const data = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < data.length; i++) {
    // 低频偏重的布朗噪声，听起来才像柴火而不是 hiss
    const white = Math.random() * 2 - 1
    last = (last + 0.02 * white) / 1.02
    data[i] = last * 3.2
  }
  return buf
}

/** 窑火：heat 0..1 控制音量与带通中心频率 */
export function setFire(heat: number): void {
  const c = audio()
  if (heat <= 0.001) {
    if (fireGain !== null) fireGain.gain.setTargetAtTime(0, c.currentTime, 0.12)
    return
  }
  if (fireSource === null || fireGain === null) {
    fireGain = c.createGain()
    fireGain.gain.value = 0
    const filter = c.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 420
    filter.Q.value = 0.7
    fireSource = c.createBufferSource()
    fireSource.buffer = noiseBuffer(c, 2.4)
    fireSource.loop = true
    fireSource.connect(filter).connect(fireGain).connect(c.destination)
    fireSource.start()
  }
  fireGain.gain.setTargetAtTime(0.02 + heat * 0.075, c.currentTime, 0.1)
}

function tone(freq: number, dur: number, gain: number, type: OscillatorType, decay: number): void {
  const c = audio()
  const osc = c.createOscillator()
  const g = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, c.currentTime)
  g.gain.setValueAtTime(0, c.currentTime)
  g.gain.linearRampToValueAtTime(gain, c.currentTime + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + decay)
  osc.connect(g).connect(c.destination)
  osc.start()
  osc.stop(c.currentTime + dur)
}

/** 珍品：铜磬，带两个泛音 */
export function chime(): void {
  tone(784, 1.6, 0.11, 'sine', 1.5)
  tone(1176, 1.4, 0.05, 'sine', 1.1)
  tone(2352, 0.9, 0.02, 'sine', 0.6)
}

/** 正品：单音木鱼 */
export function knock(): void {
  tone(420, 0.24, 0.09, 'triangle', 0.16)
}

/** 废品：炸裂 */
export function crack(): void {
  const c = audio()
  const src = c.createBufferSource()
  src.buffer = noiseBuffer(c, 0.3)
  const filter = c.createBiquadFilter()
  filter.type = 'highpass'
  filter.frequency.value = 1400
  const g = c.createGain()
  g.gain.setValueAtTime(0.16, c.currentTime)
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.22)
  src.connect(filter).connect(g).connect(c.destination)
  src.start()
  src.stop(c.currentTime + 0.3)
}

/** 落坯：闷响，带一点重量 */
export function thud(): void {
  tone(150, 0.18, 0.12, 'sine', 0.12)
  tone(92, 0.22, 0.08, 'sine', 0.16)
}
