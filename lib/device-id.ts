// Identifiant d'appareil (protection de l'essai, migration 213) : jeton aléatoire gardé dans le navigateur ou
// l'application. Sert seulement à SIGNALER un essai répété probable, jamais à bloquer. Aucune donnée personnelle.
// Stockage indisponible (navigation privée, données effacées) : null, l'inscription continue normalement.

export const DEVICE_ID_KEY = 'ss_device_id'

export function getDeviceId(): string | null {
  try {
    let v = localStorage.getItem(DEVICE_ID_KEY)
    if (!v || !/^[A-Za-z0-9_-]{16,64}$/.test(v)) {
      const bytes = new Uint8Array(16)
      crypto.getRandomValues(bytes)
      v = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
      localStorage.setItem(DEVICE_ID_KEY, v)
    }
    return v
  } catch {
    return null
  }
}
