// Horaires d'ouverture — fenêtre unique par boutique (pas de shifts par
// employé). Comparaison sur l'heure locale de l'appareil : le personnel est
// physiquement dans la boutique sur son propre appareil, donc l'heure
// locale de l'appareil correspond déjà à l'heure locale de la boutique dans
// l'immense majorité des cas — pas de fuseau horaire stocké côté serveur.
//
// Ce sont des fonctions pures (now en paramètre optionnel) — c'est un
// contrôle UX, pas une barrière de sécurité serveur, exactement comme
// isAccessAllowed() dans ./plans.ts pour le mur de facturation. La
// prolongation déléguée (hours_extension_until), elle, EST calculée
// côté serveur (fonction Postgres grant_hours_extension, migration 108) —
// nécessaire dès qu'il y a un quota à faire respecter de façon atomique.

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

/** Construit l'instant correspondant à `minutesSinceMidnight` le jour de `now`. */
function todaysInstant(now: Date, minutesSinceMidnight: number): Date {
  const d = new Date(now)
  d.setHours(Math.floor(minutesSinceMidnight / 60), minutesSinceMidnight % 60, 0, 0)
  return d
}

/**
 * Heure de fermeture effective du jour : l'horaire normal, repoussé par une
 * prolongation encore valide le cas échéant (une prolongation expirée —
 * d'un jour précédent, ou simplement dépassée — est ignorée automatiquement,
 * sans qu'aucun code n'ait besoin de la nettoyer).
 */
function resolveCloseInstant(now: Date, closeMinutes: number, extensionUntil: string | null | undefined): Date {
  let closeInstant = todaysInstant(now, closeMinutes)
  if (extensionUntil) {
    const ext = new Date(extensionUntil)
    if (!isNaN(ext.getTime()) && ext > closeInstant) closeInstant = ext
  }
  return closeInstant
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
  extensionUntil: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!hoursEnabled) return true
  if (manualOverride === 'open') return true
  if (manualOverride === 'closed') return false

  const openMinutes = parseTimeToMinutes(openingTime)
  const closeMinutes = parseTimeToMinutes(closingTime)
  if (openMinutes === null || closeMinutes === null) return true
  if (closeMinutes <= openMinutes) return true // horaires traversant minuit non gérés en v1 — fail-open plutôt que mal interpréter

  const openInstant = todaysInstant(now, openMinutes)
  const closeInstant = resolveCloseInstant(now, closeMinutes, extensionUntil)
  return now >= openInstant && now < closeInstant
}

/**
 * Millisecondes restantes avant la fermeture effective aujourd'hui (horaire
 * normal, ou l'instant repoussé par une prolongation active). null si non
 * applicable (désactivé, dérogation manuelle active, données invalides) —
 * le compte à rebours ne doit s'afficher que quand il a un sens.
 */
export function getMsUntilClosing(
  hoursEnabled: boolean | null | undefined,
  openingTime: string | null | undefined,
  closingTime: string | null | undefined,
  manualOverride: 'open' | 'closed' | null | undefined,
  extensionUntil: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!hoursEnabled || manualOverride) return null

  const openMinutes = parseTimeToMinutes(openingTime)
  const closeMinutes = parseTimeToMinutes(closingTime)
  if (openMinutes === null || closeMinutes === null || closeMinutes <= openMinutes) return null

  const closeInstant = resolveCloseInstant(now, closeMinutes, extensionUntil)
  const diff = closeInstant.getTime() - now.getTime()
  return diff > 0 ? diff : null
}
