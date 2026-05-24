/**
 * Audio context singleton.
 * Must be created/resumed during a user gesture (synchronous click handler).
 * Once running, it stays usable even after async awaits.
 */
let _ctx: AudioContext | null = null

/** Call this synchronously at the start of the click handler (before any await). */
export function unlockAudio() {
  if (typeof window === 'undefined') return
  try {
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext
    if (!Ctor) return
    if (!_ctx || _ctx.state === 'closed') _ctx = new Ctor()
    if (_ctx.state === 'suspended') _ctx.resume()
  } catch {}
}

/** Call this after the sale is confirmed (can be inside an async block). */
export function triggerSaleFeedback() {
  // Haptic — works on Android Chrome / installed PWA
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate([60, 40, 100])
  }

  // Chime — uses the already-unlocked context
  const ctx = _ctx
  if (!ctx || ctx.state !== 'running') return

  const tone = (freq: number, delay: number, dur: number, vol = 0.32) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = freq
    const t = ctx.currentTime + delay
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(vol, t + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur)
    osc.start(t)
    osc.stop(t + dur + 0.05)
  }

  tone(880,  0,    0.15)   // note basse
  tone(1320, 0.13, 0.26)   // note haute
}
