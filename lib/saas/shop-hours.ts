// Horaires d'ouverture — fenêtre unique par boutique (pas de shifts par
// employé). Comparaison sur l'heure locale de l'appareil : le personnel est
// physiquement dans la boutique sur son propre appareil, donc l'heure
// locale de l'appareil correspond déjà à l'heure locale de la boutique dans
// l'immense majorité des cas — pas de fuseau horaire stocké côté serveur.
//
// Ce sont des fonctions pures (now en paramètre optionnel) — c'est un
// contrôle UX, pas une barrière de sécurité serveur, exactement comme
// isAccessAllowed() dans ./plans.ts pour le mur de facturation.

/** Parse "HH:MM" ou "HH:MM:SS" (format renvoyé par Postgres pour une colonne time) en minutes depuis minuit. null si invalide. */
function parseTimeToMinutes(time: string | null | undefined): number | null {
  if (!time) return null
  const match = /^(\d{1,2}):(\d{2})/.exec(time)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

/**
 * Retourne false uniquement quand on est certain que la boutique est
 * fermée. Fail-open (true) sur toute donnée absente ou incohérente — une
 * mauvaise config ne doit jamais bloquer tout le monde par erreur.
 */
export function isShopOpenNow(
  hoursEnabled: boolean | null | undefined,
  openingTime: string | null | undefined,
  closingTime: string | null | undefined,
  manualOverride: 'open' | 'closed' | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!hoursEnabled) return true
  if (manualOverride === 'open') return true
  if (manualOverride === 'closed') return false

  const openMinutes = parseTimeToMinutes(openingTime)
  const closeMinutes = parseTimeToMinutes(closingTime)
  if (openMinutes === null || closeMinutes === null) return true
  if (closeMinutes <= openMinutes) return true // horaires traversant minuit non gérés en v1 — fail-open plutôt que mal interpréter

  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  return nowMinutes >= openMinutes && nowMinutes < closeMinutes
}

/**
 * Millisecondes restantes avant closing_time aujourd'hui. null si non
 * applicable (désactivé, dérogation active, données invalides) — le
 * compte à rebours ne doit s'afficher que quand il a un sens.
 */
export function getMsUntilClosing(
  hoursEnabled: boolean | null | undefined,
  openingTime: string | null | undefined,
  closingTime: string | null | undefined,
  manualOverride: 'open' | 'closed' | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!hoursEnabled || manualOverride) return null

  const openMinutes = parseTimeToMinutes(openingTime)
  const closeMinutes = parseTimeToMinutes(closingTime)
  if (openMinutes === null || closeMinutes === null || closeMinutes <= openMinutes) return null

  const closing = new Date(now)
  closing.setHours(Math.floor(closeMinutes / 60), closeMinutes % 60, 0, 0)
  const diff = closing.getTime() - now.getTime()
  return diff > 0 ? diff : null
}
