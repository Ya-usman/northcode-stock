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

/** Sous-total d'une ligne, arrondi comme en caisse */
export const lineSubtotal = (quantity: number, unitPrice: number) => Math.round(quantity * unitPrice)

/** Total d'une vente à partir de ses lignes, de la remise et du taux de taxe de la boutique */
export function computeTotals(lines: { quantity: number; unit_price: number }[], discount: number, taxRate: number) {
  const subtotal = lines.reduce((s, l) => s + lineSubtotal(Number(l.quantity), Number(l.unit_price)), 0)
  const d = Math.max(0, Number(discount) || 0)
  const tax = taxRate > 0 ? (subtotal - d) * (taxRate / 100) : 0
  return { subtotal, discount: d, tax, total: subtotal - d + tax }
}
