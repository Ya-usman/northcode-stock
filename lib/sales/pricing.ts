// Prix en vigueur d'un produit — RÈGLE UNIQUE, partagée par la caisse
// (app/[locale]/(app)/sales/new) et par le contrôle serveur de la vente
// (lib/api/sale-validation.ts). Module pur.
//
// Priorité : promo du lot FEFO en tête de file (celui qui sera vendu en
// premier, voir migration 095) → promo produit (091) → prix catalogue.
// Un prix de ligne ne descend jamais sous ce plancher ; au-dessus, libre
// (marchandage à la hausse, décision du 5 oct. 2026).

export interface PromoWindow { price: number; until: string | null; start: string | null }

export interface PricedProduct {
  selling_price: number
  promo_price?: number | null
  promo_until?: string | null
  promo_start?: string | null
}

export function isPromoActive(until: string | null | undefined, start: string | null | undefined, now: string): boolean {
  return !!until && until >= now && (!start || start <= now)
}

export function effectivePrice(product: PricedProduct, batchPromo?: PromoWindow | null, now: string = new Date().toISOString()): number {
  if (batchPromo && batchPromo.price > 0 && isPromoActive(batchPromo.until, batchPromo.start, now)) return Number(batchPromo.price)
  if (product.promo_price && isPromoActive(product.promo_until, product.promo_start, now)) return Number(product.promo_price)
  return Number(product.selling_price)
}

// ── Prix de gros par paliers (migration 202, 2 nov. 2026) ────────────────────────────────────────────────────────
// « Dès 12 : 470 F · dès 24 : 450 F » (jusqu'à 3 paliers) : la ligne prend le MEILLEUR palier atteint par sa quantité
// (toute la ligne). Promo et gros ensemble : le client paie le moins cher des deux (décision du 1er nov. 2026).
export interface PriceTier { min_qty: number; price: number }
export interface WholesalePricing { price_tiers?: PriceTier[] | null }

/** Paliers valides, du plus petit au plus grand (une donnée abîmée n'en donne aucun, jamais un prix au hasard) */
export function tiersOf(product: WholesalePricing): PriceTier[] {
  const raw = Array.isArray(product.price_tiers) ? product.price_tiers : []
  const t = raw.map(x => ({ min_qty: Number(x?.min_qty), price: Number(x?.price) }))
    .filter(x => Number.isInteger(x.min_qty) && x.min_qty >= 2 && x.price > 0)
    .sort((a, b) => a.min_qty - b.min_qty)
  return t.every((x, i) => i === 0 || (x.min_qty > t[i - 1].min_qty && x.price < t[i - 1].price)) ? t.slice(0, 3) : []
}

/** Prix de gros applicable à cette quantité (meilleur palier atteint), ou null */
export function wholesaleFor(product: WholesalePricing, quantity: number): number | null {
  const q = Number(quantity) || 0
  const reached = tiersOf(product).filter(x => q >= x.min_qty)
  return reached.length ? reached[reached.length - 1].price : null
}

/** Prochain palier pas encore atteint : pièces qui manquent et son prix (null : aucun palier au-dessus) */
export function nextTier(product: WholesalePricing, quantity: number): { missing: number; price: number; min_qty: number } | null {
  const q = Number(quantity) || 0
  const next = tiersOf(product).find(x => q < x.min_qty)
  return next ? { missing: next.min_qty - q, price: next.price, min_qty: next.min_qty } : null
}

/** Prix à la pièce d'une ligne de vente (et plancher contrôlé par le serveur) : prix en vigueur, ou palier de gros
 *  atteint s'il est moins cher */
export function linePrice(product: PricedProduct & WholesalePricing, quantity: number, batchPromo?: PromoWindow | null, now: string = new Date().toISOString()): { price: number; wholesale: boolean } {
  const base = effectivePrice(product, batchPromo, now)
  const w = wholesaleFor(product, quantity)
  return w !== null && w < base ? { price: w, wholesale: true } : { price: base, wholesale: false }
}

/** Sous-total d'une ligne, arrondi comme en caisse */
export const lineSubtotal = (quantity: number, unitPrice: number) => Math.round(quantity * unitPrice)

/** Total d'une vente à partir de ses lignes, de la remise et du taux de taxe de la boutique */
export function computeTotals(lines: { quantity: number; unit_price: number }[], discount: number, taxRate: number) {
  const subtotal = lines.reduce((s, l) => s + lineSubtotal(Number(l.quantity), Number(l.unit_price)), 0)
  const d = Math.max(0, Number(discount) || 0)
  const tax = taxRate > 0 ? (subtotal - d) * (taxRate / 100) : 0
  return { subtotal, discount: d, tax, total: subtotal - d + tax }
}
