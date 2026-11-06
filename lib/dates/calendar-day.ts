// Jour du calendrier (AAAA-MM-JJ) d'une borne de période envoyée par un écran, pour filtrer une colonne `date`
// (dépenses). Les écrans envoient le début ou la fin d'une journée LOCALE convertis en UTC : à Douala (UTC+1), le
// 6 nov. à 0 h devient « 2026-11-05T23:00:00.000Z » ; couper la chaîne donnait la VEILLE (dépenses d'hier comptées
// dans « Aujourd'hui », dépense du 31 octobre dans « Dépenses du mois » de novembre).
// Le jour explicite envoyé par l'écran fait foi. Sans lui (anciennes versions de l'application), il est déduit de
// l'instant : une borne de début ou de fin de journée locale est toujours à moins de 12 h de minuit local, quel que
// soit le fuseau (UTC−11 à UTC+12).

const DAY = /^\d{4}-\d{2}-\d{2}$/

function isRealDay(value: string): boolean {
  if (!DAY.test(value)) return false
  const d = new Date(value + 'T00:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/**
 * @param explicit  jour envoyé par l'écran (AAAA-MM-JJ), facultatif
 * @param iso       instant de la borne (ISO)
 * @param edge      'start' pour un début de journée, 'end' pour une fin de journée
 */
export function calendarDay(explicit: string | null | undefined, iso: string, edge: 'start' | 'end'): string {
  if (explicit && isRealDay(explicit)) return explicit
  const t = new Date(iso).getTime()
  // Début : minuit local + 12 h ; fin : 23 h 59 min 59 s local − 11 h 59 min (la fin de journée à UTC+12 est à 12 h pile)
  return new Date(t + (edge === 'start' ? 12 * 3600e3 : -(12 * 3600e3 - 60e3))).toISOString().slice(0, 10)
}

/**
 * Début de période en jour du calendrier, après le plafond d'historique de la formule : si le début demandé a été
 * relevé (clampStart), c'est le jour du plafond qui compte.
 */
export function startDayAfterClamp(explicit: string | null | undefined, rawIso: string, clampedIso: string): string {
  const day = calendarDay(explicit, rawIso, 'start')
  if (clampedIso === rawIso) return day
  const floorDay = clampedIso.slice(0, 10)
  return floorDay > day ? floorDay : day
}
