// Règle UNIQUE de péremption d'un lot : statut, jours restants, ordre d'affichage.
// Tout se calcule en JOURS CALENDAIRES du téléphone (« AAAA-MM-JJ »), jamais en
// heure universelle : un lot ne change pas de statut la veille au soir. Le seuil
// « bientôt » est celui de StockShop (catégorie, sinon boutique, sinon 14 jours :
// lib/utils/expiry) ; les signaux par produit (lib/stock/signals) s'appuient sur
// les mêmes fonctions. Aucune dépendance : testable tel quel.

export type BatchExpiryStatus = 'expired' | 'expiring' | 'ok' | 'none'

/** Jour d'une date ou d'un horodatage, « AAAA-MM-JJ » */
export const dayOf = (value: string): string => value.slice(0, 10)

const toUtc = (day: string): number => {
  const [y, m, d] = dayOf(day).split('-').map(Number)
  return Date.UTC(y, (m || 1) - 1, d || 1)
}

/** `day` + n jours calendaires */
export function addDays(day: string, n: number): string {
  return new Date(toUtc(day) + n * 86_400_000).toISOString().slice(0, 10)
}

/** Nombre de jours calendaires de `from` à `to` (négatif si `to` est passé) */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000)
}

/** Une date-jour lue comme un jour LOCAL (new Date('2026-10-18') serait minuit en heure universelle) */
export function localDate(day: string): Date {
  const [y, m, d] = dayOf(day).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

/**
 * Statut d'un lot. Un lot qui périme aujourd'hui n'est pas encore périmé (même
 * règle que le « Disponible ») : il « expire bientôt ».
 */
export function batchExpiryStatus(expiryDate: string | null | undefined, alertDays: number, today: string): BatchExpiryStatus {
  if (!expiryDate) return 'none'
  const exp = dayOf(expiryDate)
  if (exp < today) return 'expired'
  return exp <= addDays(today, alertDays) ? 'expiring' : 'ok'
}

export type ExpiryCountdown =
  | { kind: 'today' }
  | { kind: 'tomorrow' }
  | { kind: 'days'; count: number }
  | { kind: 'months'; count: number }
  | { kind: 'expired'; count: number }

/** Au-delà de ce nombre de jours, le délai se lit mieux en mois (« dans environ 5 mois ») */
export const COUNTDOWN_DAYS_MAX = 60

/** Délai lisible avant (ou depuis) la péremption ; null sans date : rien à calculer */
export function expiryCountdown(expiryDate: string | null | undefined, today: string): ExpiryCountdown | null {
  if (!expiryDate) return null
  const n = daysBetween(today, dayOf(expiryDate))
  if (n < 0) return { kind: 'expired', count: -n }
  if (n === 0) return { kind: 'today' }
  if (n === 1) return { kind: 'tomorrow' }
  if (n <= COUNTDOWN_DAYS_MAX) return { kind: 'days', count: n }
  return { kind: 'months', count: Math.round(n / 30) }
}

type Sortable = { id: string; product_id: string; shop_id?: string | null; quantity: number; expiry_date: string | null; received_at: string }

const RANK: Record<BatchExpiryStatus, number> = { expired: 0, expiring: 1, ok: 2, none: 3 }

/**
 * Ordre d'AFFICHAGE de l'écran : périmés, puis « expire bientôt » du plus urgent
 * au moins urgent, puis lots sains par date, puis lots sans date. Ne change rien
 * à l'ordre de sortie en caisse.
 */
export function compareBatchesForDisplay<T extends Sortable>(statusOf: (b: T) => BatchExpiryStatus) {
  return (a: T, b: T): number => {
    const r = RANK[statusOf(a)] - RANK[statusOf(b)]
    if (r) return r
    const ea = a.expiry_date ? dayOf(a.expiry_date) : '', eb = b.expiry_date ? dayOf(b.expiry_date) : ''
    if (ea !== eb) return ea < eb ? -1 : 1
    return a.received_at < b.received_at ? -1 : a.received_at > b.received_at ? 1 : 0
  }
}

/**
 * Lots qui sortent en premier à la caisse (FEFO, même tri que la base :
 * péremption la plus proche, sans date en dernier, puis le plus ancien), pour
 * les produits qui ont PLUSIEURS lots en stock — avec un seul lot, la mention
 * n'apprend rien. Lecture seule de la règle existante, pas une nouvelle règle.
 */
export function fefoHeadIds<T extends Sortable>(batches: T[]): Set<string> {
  const byProduct = new Map<string, T[]>()
  for (const b of batches) {
    if (!(b.quantity > 0)) continue
    const list = byProduct.get(b.product_id)
    if (list) list.push(b); else byProduct.set(b.product_id, [b])
  }
  const heads = new Set<string>()
  byProduct.forEach(list => {
    if (list.length < 2) return
    const head = [...list].sort((a, b) => {
      const ea = a.expiry_date ? dayOf(a.expiry_date) : null, eb = b.expiry_date ? dayOf(b.expiry_date) : null
      if (ea !== eb) { if (ea === null) return 1; if (eb === null) return -1; return ea < eb ? -1 : 1 }
      return a.received_at < b.received_at ? -1 : a.received_at > b.received_at ? 1 : 0
    })[0]
    heads.add(head.id)
  })
  return heads
}
