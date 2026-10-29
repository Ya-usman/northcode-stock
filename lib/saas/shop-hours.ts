// Horaires d'ouverture — fenêtre unique par boutique (pas de shifts par
// employé). Comparaison à l'heure LOCALE DE LA BOUTIQUE : son fuseau
// (shops.timezone, migration 178) quand il est passé en dernier paramètre —
// décision du 29 oct. 2026, même calcul pour l'écran (mur « boutique fermée »)
// et pour le serveur (lib/api/shop-hours : écritures des employés refusées
// boutique fermée). Sans fuseau : heure de l'appareil (ancien comportement).
//
// Fonctions pures (now en paramètre optionnel). La prolongation déléguée
// (hours_extension_until) est calculée côté serveur (fonction Postgres
// grant_hours_extension, migration 108) — un instant absolu.

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

/** Minutes écoulées depuis minuit à l'heure locale de la boutique (fuseau IANA), sinon de l'appareil. */
function localMinutes(now: Date, timeZone?: string | null): number {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
      const h = Number(parts.find(p => p.type === 'hour')?.value), m = Number(parts.find(p => p.type === 'minute')?.value)
      if (Number.isFinite(h) && Number.isFinite(m)) return h * 60 + m
    } catch { /* fuseau invalide : heure de l'appareil */ }
  }
  return now.getHours() * 60 + now.getMinutes()
}

/** Instant (ms) correspondant à `minutesSinceMidnight` le jour local de `now` (même jour, même fuseau). */
function todaysInstant(now: Date, minutesSinceMidnight: number, timeZone?: string | null): number {
  const startOfMinute = now.getTime() - now.getSeconds() * 1000 - now.getMilliseconds()
  return startOfMinute + (minutesSinceMidnight - localMinutes(now, timeZone)) * 60_000
}

/**
 * Heure de fermeture effective du jour : l'horaire normal, repoussé par une
 * prolongation encore valide le cas échéant (une prolongation expirée —
 * d'un jour précédent, ou simplement dépassée — est ignorée automatiquement,
 * sans qu'aucun code n'ait besoin de la nettoyer).
 */
function resolveCloseInstant(now: Date, closeMinutes: number, extensionUntil: string | null | undefined, timeZone?: string | null): number {
  let closeInstant = todaysInstant(now, closeMinutes, timeZone)
  if (extensionUntil) {
    const ext = new Date(extensionUntil).getTime()
    if (!isNaN(ext) && ext > closeInstant) closeInstant = ext
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
  timeZone?: string | null,
): boolean {
  if (!hoursEnabled) return true
  if (manualOverride === 'open') return true
  if (manualOverride === 'closed') return false

  const openMinutes = parseTimeToMinutes(openingTime)
  const closeMinutes = parseTimeToMinutes(closingTime)
  if (openMinutes === null || closeMinutes === null) return true
  if (closeMinutes <= openMinutes) return true // horaires traversant minuit non gérés en v1 — fail-open plutôt que mal interpréter

  const openInstant = todaysInstant(now, openMinutes, timeZone)
  const closeInstant = resolveCloseInstant(now, closeMinutes, extensionUntil, timeZone)
  return now.getTime() >= openInstant && now.getTime() < closeInstant
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
  timeZone?: string | null,
): number | null {
  if (!hoursEnabled || manualOverride) return null

  const openMinutes = parseTimeToMinutes(openingTime)
  const closeMinutes = parseTimeToMinutes(closingTime)
  if (openMinutes === null || closeMinutes === null || closeMinutes <= openMinutes) return null

  const closeInstant = resolveCloseInstant(now, closeMinutes, extensionUntil, timeZone)
  const diff = closeInstant - now.getTime()
  return diff > 0 ? diff : null
}

// ── Prolongations du jour ───────────────────────────────────────────────────
// Le compteur hours_extension_count n'est remis à zéro par la base qu'à la
// prochaine prolongation (grant_hours_extension, migration 108) : affiché
// tel quel, un « 2/2 » d'hier bloquait la prolongation aujourd'hui. Même
// « jour de la boutique » que la base : décalage FIXE par pays
// (shop_utc_offset_minutes), pas le fuseau réel — sinon les deux divergent.

const UTC_PLUS_1 = ['NG', 'CM', 'NE', 'BJ', 'CD', 'CG', 'GA', 'GQ', 'CF', 'TD']
const UTC_0 = ['CI', 'ML', 'SN', 'TG', 'GH', 'BF', 'GN', 'GW', 'GM', 'SL', 'LR', 'MR']

/** Copie conforme de shop_utc_offset_minutes (migration 108) */
export function shopUtcOffsetMinutes(country: string | null | undefined): number {
  const c = (country || '').toUpperCase()
  if (UTC_0.includes(c)) return 0
  if (c === 'CV') return -60
  if (UTC_PLUS_1.includes(c)) return 60
  return 60 // repli de la base (EU/US/CA)
}

/**
 * Date AAAA-MM-JJ du « jour de la boutique » au sens de la base : depuis la 186, au FUSEAU de la boutique
 * (shops.timezone) quand il est connu ; sinon décalage fixe par pays (migration 108).
 */
export function shopLocalDate(country: string | null | undefined, now = new Date(), timeZone?: string | null): string {
  if (timeZone) {
    try {
      const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
      const v = (t: string) => p.find(x => x.type === t)?.value
      if (v('year') && v('month') && v('day')) return `${v('year')}-${v('month')}-${v('day')}`
    } catch { /* fuseau invalide : décalage par pays */ }
  }
  return new Date(now.getTime() + shopUtcOffsetMinutes(country) * 60_000).toISOString().slice(0, 10)
}

/** Prolongations réellement utilisées AUJOURD'HUI (0 si le compteur date d'un autre jour) */
export function extensionsUsedToday(
  shop: { hours_extension_count?: number | null; hours_extension_count_date?: string | null; country?: string | null; timezone?: string | null },
  now = new Date(),
): number {
  const count = shop.hours_extension_count ?? 0
  if (!count || !shop.hours_extension_count_date) return 0
  return shop.hours_extension_count_date === shopLocalDate(shop.country, now, shop.timezone) ? count : 0
}

// ── Boutique fermée : à quel moment ? (demande de prolongation, 29 oct. 2026) ─────────────────────────────────
// 'open' : ouverte ; 'manual' : fermée par le propriétaire (dérogation) ; 'before_open' : avant l'ouverture du jour
// (une prolongation n'y change rien) ; 'after_close' : après la fermeture du jour (une prolongation la rouvre).
export type ClosedPhase = 'open' | 'manual' | 'before_open' | 'after_close'

export function shopClosedPhase(
  hoursEnabled: boolean | null | undefined,
  openingTime: string | null | undefined,
  closingTime: string | null | undefined,
  manualOverride: 'open' | 'closed' | null | undefined,
  extensionUntil: string | null | undefined,
  now: Date = new Date(),
  timeZone?: string | null,
): ClosedPhase {
  if (isShopOpenNow(hoursEnabled, openingTime, closingTime, manualOverride, extensionUntil, now, timeZone)) return 'open'
  if (manualOverride === 'closed') return 'manual'
  const openMinutes = parseTimeToMinutes(openingTime)
  if (openMinutes !== null && localMinutes(now, timeZone) < openMinutes) return 'before_open'
  return 'after_close'
}
