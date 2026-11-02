// Création d'un produit côté serveur (lot A des ajouts, 1er nov. 2026) : les règles de champ sont celles de l'import
// (checkProductFields, une seule vérité) ; seuls les champs ci-dessous peuvent être fixés à la création. Le reste
// (suivi par numéro de série, kit, promotion, archivage, identifiants, dates) ne se règle jamais par cette route.
import { normalizeTiers, type TierProblem } from '@/lib/products/price-tiers'
import { checkProductFields, normalizeText, PRODUCT_UNITS, SKU_MAX_LENGTH, type RowIssue } from '@/lib/import/products-import'

/** Refus d'un champ → message traduit (api_errors) et champ du formulaire à signaler */
const ISSUE_MESSAGES: Partial<Record<RowIssue, { key: string; field?: 'name' | 'sku' | 'selling_price' | 'buying_price' | 'quantity' | 'unit' | 'location' | 'low_stock_threshold' | 'expiry_date' }>> = {
  missing_name: { key: 'product_name_required', field: 'name' },
  name_too_long: { key: 'product_name_too_long', field: 'name' },
  missing_price: { key: 'product_selling_price_invalid', field: 'selling_price' },
  invalid_price: { key: 'product_selling_price_invalid', field: 'selling_price' },
  invalid_buying_price: { key: 'product_buying_price_invalid', field: 'buying_price' },
  invalid_quantity: { key: 'product_quantity_invalid', field: 'quantity' },
  invalid_threshold: { key: 'product_threshold_invalid', field: 'low_stock_threshold' },
  unknown_unit: { key: 'product_unit_invalid', field: 'unit' },
  invalid_expiry_date: { key: 'date_invalid', field: 'expiry_date' },
  sku_damaged: { key: 'barcode_invalid', field: 'sku' },
  sku_too_long: { key: 'sku_too_long', field: 'sku' },
  sku_invalid_barcode: { key: 'barcode_invalid', field: 'sku' },
  location_too_long: { key: 'location_too_long', field: 'location' },
}

export type NewProductCheck =
  | { ok: true; row: Record<string, unknown>; expiry_date: string | null }
  | { ok: false; key: string; field?: string }

/** Corps de POST /api/products → ligne à insérer (liste fermée de champs), ou refus traduit. */
export function newProductRow(body: Record<string, any>, seesCost: boolean): NewProductCheck {
  const c = checkProductFields({
    name: body.name, selling_price: body.selling_price, buying_price: seesCost ? body.buying_price : null,
    quantity: body.quantity, unit: body.unit, sku: typeof body.sku === 'string' ? body.sku : body.sku ?? null,
    low_stock_threshold: body.low_stock_threshold, location: body.location, expiry_date: body.expiry_date,
  })
  if (!c.ok) { const m = ISSUE_MESSAGES[c.issue] ?? { key: 'invalid_data' }; return { ok: false, key: m.key, field: m.field } }
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const row: Record<string, unknown> = {
    shop_id: body.shop_id,
    name: c.product.name,
    selling_price: c.product.selling_price,
    quantity: c.product.quantity,
    unit: c.product.unit,
    sku: c.product.sku,
    low_stock_threshold: c.product.low_stock_threshold,
    location: c.product.location,
    category_id: str(body.category_id, 64),
    supplier_id: str(body.supplier_id, 64),
    image_url: str(body.image_url, 2000),
    is_active: true,
  }
  // Prix d'achat : seulement avec le droit au coût — sinon jamais écrit (coût inconnu)
  if (seesCost) row.buying_price = c.product.buying_price
  // Paliers de gros facultatifs (202) : mêmes règles qu'en modification
  if (body.price_tiers !== undefined) {
    const w: Record<string, unknown> = { price_tiers: body.price_tiers }
    const issue = checkPriceTiers(w, c.product.selling_price)
    if (issue) return { ok: false, key: issue.key, field: issue.field }
    row.price_tiers = w.price_tiers
  }
  return { ok: true, row, expiry_date: c.expiry_date }
}

/** Modification (PATCH) : mêmes règles que la création, pour les seuls champs envoyés ; les valeurs sont nettoyées
 *  sur place (nom resserré, seuil vide = seuil de la boutique). Renvoie le refus traduit, ou null. */
export function checkProductPatch(u: Record<string, unknown>): { key: string; field: string } | null {
  if ('name' in u) {
    const name = String(u.name ?? '').replace(/\s+/g, ' ').trim()
    if (!name) return { key: 'product_name_required', field: 'name' }
    if (name.length > 200) return { key: 'product_name_too_long', field: 'name' }
    u.name = name
  }
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
  if ('selling_price' in u) {
    const n = num(u.selling_price)
    if (n === null || !Number.isFinite(n) || !(n > 0)) return { key: 'product_selling_price_invalid', field: 'selling_price' }
    u.selling_price = n
  }
  if ('buying_price' in u) {
    const n = num(u.buying_price)
    if (n !== null && (!Number.isFinite(n) || n < 0)) return { key: 'product_buying_price_invalid', field: 'buying_price' }
    u.buying_price = n ?? 0
  }
  if ('low_stock_threshold' in u) {
    // Vide = seuil de la boutique ; 0 = pas d'alerte « stock faible » (règle du 1er nov. 2026)
    const n = num(u.low_stock_threshold)
    if (n !== null && (!Number.isInteger(n) || n < 0)) return { key: 'product_threshold_invalid', field: 'low_stock_threshold' }
    u.low_stock_threshold = n
  }
  if ('unit' in u && !(PRODUCT_UNITS as readonly string[]).includes(String(u.unit))) return { key: 'product_unit_invalid', field: 'unit' }
  if ('sku' in u && typeof u.sku === 'string' && u.sku.trim().length > SKU_MAX_LENGTH) return { key: 'sku_too_long', field: 'sku' }
  return null
}

/** Paliers de gros (migration 202) : jusqu'à 3 { min_qty, price } ; lignes entièrement vides ignorées ; quantités
 *  entières de 2 à 100 000, toutes différentes ; chaque palier moins cher que le précédent et le premier sous le prix de
 *  détail FINAL (un même envoi peut changer les deux). Valeur nettoyée sur place : liste triée, ou null (aucun palier). */
export function checkPriceTiers(u: Record<string, unknown>, finalRetail: number): { key: string; field: string } | null {
  if (!('price_tiers' in u)) return null
  const r = normalizeTiers(u.price_tiers, finalRetail)
  if (!r.ok) return { key: r.problem === 'invalid' ? 'invalid_data' : TIER_KEYS[r.problem], field: 'price_tiers' }
  u.price_tiers = r.tiers
  return null
}
const TIER_KEYS: Record<Exclude<TierProblem, 'invalid'>, string> = {
  too_many: 'product_wholesale_too_many', incomplete: 'product_wholesale_incomplete', price: 'product_wholesale_price_invalid',
  min: 'product_wholesale_min_invalid', order: 'product_wholesale_order', not_below: 'product_wholesale_not_below_retail',
}

export interface ShopProductKey { id: string; name: string; sku: string | null; is_active: boolean | null }

/** Produits de la boutique (nom, code-barres, actif ou archivé), par pages de 1 000 : base des contrôles de doublons */
export async function shopProductKeys(admin: any, shopId: string): Promise<{ data: ShopProductKey[]; error: string | null }> {
  const out: ShopProductKey[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('products').select('id, name, sku, is_active').eq('shop_id', shopId).order('id').range(from, from + 999)
    if (error) return { data: out, error: error.message }
    out.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return { data: out, error: null }
}

/** Même nom (sans casse ni accents) qu'un produit de la boutique : actif = doublon, archivé = à restaurer */
export function sameNameProduct<T extends { name: string; is_active: boolean | null }>(name: string, products: T[]): T | null {
  const key = normalizeText(name)
  const same = products.filter(p => normalizeText(p.name) === key)
  return same.find(p => p.is_active !== false) ?? same[0] ?? null
}
