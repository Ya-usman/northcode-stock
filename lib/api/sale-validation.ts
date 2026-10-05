// Contrôle serveur d'une vente AVANT enregistrement (lot 1, 5 oct. 2026).
// Avant : /api/sales/checkout transmettait prix, remise et total tels que
// le navigateur les envoyait ; la règle « jamais sous le prix en vigueur »
// n'existait que dans l'écran. Ici, avec un client admin :
//   1. chaque ligne est au moins au prix en vigueur (lib/sales/pricing.ts) ;
//   2. une remise exige le droit « discount » ;
//   3. sous-total, taxe et total sont recalculés depuis les lignes.
// Tolérance d'une demi-unité : absorbe les arrondis, pas une manipulation.

import { effectivePrice, computeTotals, type PromoWindow } from '@/lib/sales/pricing'

export interface SaleLineInput { product_id: string; product_name?: string; quantity: number; unit_price: number }
export interface SaleAmountsInput { subtotal: number; discount: number; tax: number; total: number }
export type SaleValidation =
  | { ok: true }
  | { ok: false; error: 'price_below_floor' | 'discount_not_allowed' | 'sale_total_mismatch' | 'invalid_data'; params?: Record<string, string | number> }

const TOLERANCE = 0.5

/** Lot FEFO en tête de file par produit (même tri que la caisse) → promo éventuelle */
async function loadFrontBatchPromos(admin: any, shopId: string, productIds: string[]): Promise<Record<string, PromoWindow>> {
  const { data } = await admin.from('product_batches')
    .select('product_id, promo_price, promo_until, promo_start')
    .eq('shop_id', shopId).in('product_id', productIds).gt('quantity', 0)
    .order('expiry_date', { ascending: true, nullsFirst: false })
    .order('received_at', { ascending: true })
  const seen = new Set<string>(); const out: Record<string, PromoWindow> = {}
  for (const b of data || []) {
    if (seen.has(b.product_id)) continue
    seen.add(b.product_id)
    if (b.promo_price && b.promo_until) out[b.product_id] = { price: Number(b.promo_price), until: b.promo_until, start: b.promo_start ?? null }
  }
  return out
}

/** Plancher de prix seul (modification d'une vente : le total est recalculé par edit_sale) */
export async function validateLinePrices(admin: any, shopId: string, items: SaleLineInput[]): Promise<SaleValidation> {
  const priced = items.filter(i => i.product_id)
  if (!priced.length) return { ok: true }
  const ids = Array.from(new Set(priced.map(i => i.product_id)))
  const [{ data: products }, batchPromos] = await Promise.all([
    admin.from('products').select('id, name, selling_price, promo_price, promo_until, promo_start').eq('shop_id', shopId).in('id', ids),
    loadFrontBatchPromos(admin, shopId, ids),
  ])
  const byId = new Map<string, any>((products || []).map((p: any) => [p.id, p]))
  const now = new Date().toISOString()
  for (const it of priced) {
    const p = byId.get(it.product_id); if (!p) continue
    const floor = effectivePrice(p, batchPromos[it.product_id] ?? null, now)
    if (Number(it.unit_price) < floor - 0.005) return { ok: false, error: 'price_below_floor', params: { name: p.name, floor } }
  }
  return { ok: true }
}

export async function validateSale(
  admin: any,
  shopId: string,
  items: SaleLineInput[],
  amounts: SaleAmountsInput,
  opts: { discountAllowed: boolean },
): Promise<SaleValidation> {
  if (!Array.isArray(items) || !items.length) return { ok: false, error: 'invalid_data' }
  for (const it of items) {
    if (!it.product_id || !(Number(it.quantity) > 0) || !Number.isFinite(Number(it.unit_price)) || Number(it.unit_price) < 0) return { ok: false, error: 'invalid_data' }
  }
  const ids = Array.from(new Set(items.map(i => i.product_id)))
  const [{ data: products }, batchPromos, { data: shop }] = await Promise.all([
    admin.from('products').select('id, name, selling_price, promo_price, promo_until, promo_start').eq('shop_id', shopId).in('id', ids),
    loadFrontBatchPromos(admin, shopId, ids),
    admin.from('shops').select('tax_rate').eq('id', shopId).maybeSingle(),
  ])
  const byId = new Map<string, any>((products || []).map((p: any) => [p.id, p]))
  const now = new Date().toISOString()
  for (const it of items) {
    const p = byId.get(it.product_id)
    if (!p) continue // produit d'une autre boutique : refusé par complete_sale (P0008)
    const floor = effectivePrice(p, batchPromos[it.product_id] ?? null, now)
    if (Number(it.unit_price) < floor - 0.005) {
      return { ok: false, error: 'price_below_floor', params: { name: p.name, floor } }
    }
  }
  const discount = Number(amounts.discount) || 0
  if (discount > 0.005 && !opts.discountAllowed) return { ok: false, error: 'discount_not_allowed' }
  const expected = computeTotals(items, discount, Number(shop?.tax_rate) || 0)
  if (discount < 0 || discount > expected.subtotal + TOLERANCE) return { ok: false, error: 'sale_total_mismatch' }
  const near = (a: number, b: number) => Math.abs(Number(a) - b) <= TOLERANCE + 0.01 * items.length
  if (!near(amounts.subtotal, expected.subtotal) || !near(amounts.tax, expected.tax) || !near(amounts.total, expected.total)) {
    return { ok: false, error: 'sale_total_mismatch' }
  }
  return { ok: true }
}
