// Stock VENDABLE d'un produit (migration 178) — module PUR, même formule que la fonction SQL sellable_stock.
// Référence unique pour le serveur, la caisse et le module Stock :
//   fresh        = Σ lots non périmés à la date métier
//   expired      = Σ lots périmés (expiry_date < date métier)
//   untracked    = max(physique − (fresh + expired), 0)   — stock historique sans lot : vendable (date inconnue)
//   sellable     = min(physique, fresh + untracked)       — quantité réellement vendable (contrôle serveur)
//   nonSellable  = physique − sellable                    — non vendable car périmé (jamais plus que le physique)
// Robuste aux incohérences historiques produit ↔ lots (lots > physique, stock sans lot…).
// Réservations (172) : indicatives, elles ne bloquent pas le serveur — availableAfterReservations est
// l'affichage « disponible » du module Stock et l'avertissement de la caisse.
import { countryDefaultTimeZone, businessDate } from '@/lib/time/time-zones'

export interface LotQty { quantity: number; expiry_date: string | null }

export interface SellableStock {
  physical: number
  fresh: number
  expired: number
  untracked: number
  sellable: number
  nonSellable: number
}

/** Un lot est périmé si sa date est STRICTEMENT avant la date métier (le jour même : encore vendable) */
export const isLotExpired = (expiryDate: string | null | undefined, asOf: string | null | undefined): boolean =>
  !!expiryDate && !!asOf && expiryDate.slice(0, 10) < asOf

export function sellableStock(physical: number, lots: LotQty[], asOf: string | null): SellableStock {
  const p = Math.max(0, Math.floor(Number(physical) || 0))
  let fresh = 0, expired = 0
  for (const l of lots) {
    const q = Math.max(0, Number(l.quantity) || 0)
    if (!q) continue
    if (isLotExpired(l.expiry_date, asOf)) expired += q
    else fresh += q
  }
  const untracked = Math.max(p - (fresh + expired), 0)
  const sellable = Math.min(p, fresh + untracked)
  return { physical: p, fresh, expired, untracked, sellable, nonSellable: p - sellable }
}

export const availableAfterReservations = (sellable: number, reserved: number | null | undefined): number =>
  Math.max(0, sellable - Math.max(0, Number(reserved) || 0))

/**
 * Date métier d'une boutique (AAAA-MM-JJ). shops.timezone fait foi ; avant la migration 178 (colonne absente),
 * repli transitoire sur le fuseau unique du pays, puis sur le jour de l'appareil — jamais côté serveur.
 */
export function shopToday(shop: { timezone?: string | null; country?: string | null } | null | undefined, at: Date = new Date()): string {
  const tz = shop?.timezone || countryDefaultTimeZone(shop?.country)
  if (tz) return businessDate(tz, at)
  const d = at
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
