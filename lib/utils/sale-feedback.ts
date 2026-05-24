/**
 * Audio context singleton.
 * Must be created/resumed during a user gesture (synchronous click handler).
 */
let _ctx: AudioContext | null = null

/** Call this synchronously at the start of a click handler (before any await). */
export function unlockAudio() {
  if (typeof window === 'undefined') return
  try {
    const Ctor = window.AudioContext ?? (window as any).webkitAudioContext
    if (!Ctor) return
    if (!_ctx || _ctx.state === 'closed') _ctx = new Ctor()
    if (_ctx.state === 'suspended') _ctx.resume()
  } catch {}
}

/** Native haptic via Capacitor — works even in silent/low-volume mode. */
async function vibrateNative() {
  try {
    const cap = (window as any).Capacitor
    if (!cap?.isNativePlatform?.()) return false

    const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
    // Heavy impact suivi d'un medium — ressemble à un double buzz
    await Haptics.impact({ style: ImpactStyle.Heavy })
    await new Promise(r => setTimeout(r, 80))
    await Haptics.impact({ style: ImpactStyle.Medium })
    return true
  } catch {
    return false
  }
}

/** Web fallback via navigator.vibrate — dépend du mode du téléphone. */
function vibrateWeb() {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return
  // Motif long pour être bien perceptible
  navigator.vibrate([120, 60, 180])
}

/** Chime two-tone — uses the already-unlocked AudioContext. */
function playChime() {
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

  tone(880,  0,    0.15)
  tone(1320, 0.13, 0.26)
}

/**
 * Triggered on every completed sale (cashier side) and on every
 * incoming sale notification (admin side via Realtime).
 */
export async function triggerSaleFeedback() {
  if (typeof localStorage === 'undefined') return

  const alertEnabled = localStorage.getItem('notify_push_new_sale') !== '0'
  const soundEnabled = localStorage.getItem('sale_sound_enabled') !== '0'

  if (!alertEnabled || !soundEnabled) return

  const usedNative = await vibrateNative()
  if (!usedNative) vibrateWeb()
  playChime()
}
