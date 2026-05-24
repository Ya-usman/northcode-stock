/**
 * Triggered on every completed sale.
 * - Vibration: short double buzz on Android / supported browsers
 * - Sound: ascending two-tone chime via Web Audio API (no file needed)
 */
export function triggerSaleFeedback() {
  // Haptic
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate([60, 40, 100])
  }

  // Chime
  try {
    const AudioCtx = window.AudioContext ?? (window as any).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx() as AudioContext

    const tone = (freq: number, startAt: number, dur: number, vol = 0.28) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.value = freq
      const t = ctx.currentTime + startAt
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(vol, t + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur)
      osc.start(t)
      osc.stop(t + dur)
    }

    tone(880,  0,    0.14)   // fa# — note basse
    tone(1320, 0.11, 0.22)   // mi  — note haute
    setTimeout(() => ctx.close(), 700)
  } catch {
    // Audio non supporté, silencieux
  }
}
