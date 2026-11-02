// Mesures de vente (migration 203, 2 nov. 2026) : riz au verre, à la boîte, au seau, au sac ; eau au pack, au carton.
// UNE règle, partagée par le formulaire produit, la caisse et le serveur (lib/api/new-product, lib/api/sale-validation).
// Base de données : même contrôle (public.valid_sale_measures, sale_items_measure_check). Module pur.
//
// Le stock reste compté dans l'unité du produit, en nombres entiers. Chaque mesure est INDÉPENDANTE : son propre prix,
// et un contenu (en unités du produit) qui sert seulement au stock : grains comptés en grammes (verre ≈ 250 g,
// boîte ≈ 700 g), produits qui se comptent à la pièce (carton = 24 pièces). Le prix d'une mesure n'est jamais calculé
// à partir d'une autre. Une ligne de vente garde la mesure : « 3 boîtes · Riz », jamais exprimée dans une autre mesure.

export const MEASURE_KEYS = ['glass', 'cup', 'box', 'pack', 'sachet', 'heap', 'bowl', 'half_kg', 'kg', 'bag', 'bottle', 'litre', 'bucket', 'custom'] as const
export type MeasureKey = typeof MEASURE_KEYS[number]
export const MAX_MEASURES = 5
export const MEASURE_LABEL_MAX = 20
export const MIN_MEASURE_UNITS = 2
export const MAX_MEASURE_UNITS = 100000

export interface SaleMeasure { key: MeasureKey; label?: string | null; units: number; price: number }
export interface SaleMeasureInput { key?: unknown; label?: unknown; units?: unknown; price?: unknown }
export type MeasureProblem = 'invalid' | 'too_many' | 'incomplete' | 'key' | 'label' | 'units' | 'price' | 'duplicate' | 'fixed'

/** Unités « fines » : le stock est compté en grammes ou en millilitres, affiché et saisi au kilo ou au litre */
export const isFineUnit = (unit: string | null | undefined) => unit === 'g' || unit === 'ml'
/** Unité d'affichage d'une unité fine (g → kg, ml → litre) */
export const coarseUnitOf = (unit: string | null | undefined): string | null => (unit === 'g' ? 'kg' : unit === 'ml' ? 'litre' : null)
export const FINE_FACTOR = 1000

/** Contenu imposé d'une mesure pour une unité de stock (kilo = 1 000 g, demi-kilo = 500 g, litre = 1 000 ml), sinon null */
export function fixedUnits(key: string, baseUnit: string | null | undefined): number | null {
  if (baseUnit === 'g') return key === 'kg' ? 1000 : key === 'half_kg' ? 500 : null
  if (baseUnit === 'ml') return key === 'litre' ? 1000 : null
  return null
}

/** Mesures proposées d'abord selon l'unité du produit (les autres restent possibles) */
export function suggestedKeys(baseUnit: string | null | undefined): MeasureKey[] {
  if (baseUnit === 'g' || baseUnit === 'kg') return ['glass', 'box', 'bowl', 'heap', 'bucket', 'half_kg', 'kg', 'bag', 'sachet', 'cup']
  if (baseUnit === 'ml' || baseUnit === 'litre') return ['glass', 'cup', 'bottle', 'litre', 'bucket', 'sachet']
  return ['pack', 'box', 'sachet', 'heap', 'bag', 'bottle', 'bucket', 'glass', 'cup', 'bowl']
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
const cleanLabel = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '')

/** Identité d'une mesure (une seule fois par produit) : clé, et libellé pour une mesure libre (sans la casse) */
export const measureId = (m: { key: string; label?: string | null }) => `${m.key}|${m.key === 'custom' ? cleanLabel(m.label).toLowerCase() : ''}`

/** Mesures saisies → liste propre (null = aucune), ou le problème à corriger. Lignes entièrement vides ignorées. */
export function normalizeMeasures(raw: unknown, baseUnit?: string | null): { ok: true; measures: SaleMeasure[] | null } | { ok: false; problem: MeasureProblem; index?: number } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, measures: null }
  if (!Array.isArray(raw)) return { ok: false, problem: 'invalid' }
  const rows = raw.map((r: SaleMeasureInput) => ({ key: typeof r?.key === 'string' ? r.key : '', label: cleanLabel(r?.label), units: num(r?.units), price: num(r?.price) }))
    .map((r, index) => ({ ...r, index }))
    .filter(r => r.key || r.label || r.units !== null || r.price !== null)
  if (!rows.length) return { ok: true, measures: null }
  if (rows.length > MAX_MEASURES) return { ok: false, problem: 'too_many' }
  const out: SaleMeasure[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (!r.key || r.units === null || r.price === null) return { ok: false, problem: 'incomplete', index: r.index }
    if (!(MEASURE_KEYS as readonly string[]).includes(r.key)) return { ok: false, problem: 'key', index: r.index }
    if (r.key === 'custom' && (!r.label || r.label.length > MEASURE_LABEL_MAX)) return { ok: false, problem: 'label', index: r.index }
    if (!Number.isFinite(r.price) || !(r.price > 0)) return { ok: false, problem: 'price', index: r.index }
    if (!Number.isInteger(r.units) || r.units < MIN_MEASURE_UNITS || r.units > MAX_MEASURE_UNITS) return { ok: false, problem: 'units', index: r.index }
    const fixed = fixedUnits(r.key, baseUnit)
    if (fixed !== null && r.units !== fixed) return { ok: false, problem: 'fixed', index: r.index }
    const m: SaleMeasure = r.key === 'custom' ? { key: 'custom', label: r.label, units: r.units, price: r.price } : { key: r.key as MeasureKey, units: r.units, price: r.price }
    const id = measureId(m)
    if (seen.has(id)) return { ok: false, problem: 'duplicate', index: r.index }
    seen.add(id)
    out.push(m)
  }
  // Rangées du plus petit contenu au plus grand : verre, boîte, seau, sac (même ordre en caisse)
  return { ok: true, measures: out.sort((a, b) => a.units - b.units) }
}

/** Mesures valides d'un produit lu en base (une donnée abîmée n'en donne aucune, jamais une mesure au hasard) */
export function measuresOf(product: { sale_measures?: unknown } | null | undefined): SaleMeasure[] {
  const r = normalizeMeasures(product?.sale_measures ?? null)
  return r.ok && r.measures ? r.measures : []
}

/** La mesure du produit qui correspond à une ligne de vente (clé, et libellé pour une mesure libre), ou null */
export function findMeasure(product: { sale_measures?: unknown }, key: unknown, label?: unknown): SaleMeasure | null {
  if (typeof key !== 'string' || !key) return null
  const id = measureId({ key, label: typeof label === 'string' ? label : null })
  return measuresOf(product).find(m => measureId(m) === id) ?? null
}

/** Produit en grammes ou en millilitres avec des mesures : il se vend uniquement par mesures (jamais « 1 gramme ») */
export const soldOnlyByMeasures = (product: { unit?: string | null; sale_measures?: unknown }) => isFineUnit(product.unit) && measuresOf(product).length > 0

/** Prix d'une unité de stock dans une ligne vendue à la mesure : prix de la mesure ÷ contenu (8 décimales, pour que
 *  quantité × prix redonne le prix exact de la mesure, au centime près) */
export const measureUnitPrice = (price: number, units: number) => Number((Number(price) / Math.max(1, Math.round(units))).toFixed(8))

/** Champs d'une ligne de vente à la mesure, tels qu'enregistrés (sale_items.measure_*, contrôle 203) */
export interface MeasureLine { measure_key: string; measure_label: string | null; measure_qty: number; measure_units: number }

export function measureLineFields(m: SaleMeasure, qty: number): MeasureLine & { quantity: number; unit_price: number; subtotal: number } {
  const q = Math.max(1, Math.round(qty))
  const unitPrice = measureUnitPrice(m.price, m.units)
  return {
    measure_key: m.key, measure_label: m.key === 'custom' ? (m.label ?? null) : null, measure_qty: q, measure_units: m.units,
    // Même arrondi que les autres lignes (lib/sales/pricing lineSubtotal) : le serveur recalcule les totaux ainsi
    quantity: q * m.units, unit_price: unitPrice, subtotal: Math.round(q * m.units * unitPrice),
  }
}

/** Ligne de vente à la mesure cohérente (mêmes règles que sale_items_measure_check) */
export function validMeasureLine(it: { quantity?: unknown; measure_key?: unknown; measure_label?: unknown; measure_qty?: unknown; measure_units?: unknown }): boolean {
  const none = [it.measure_key, it.measure_label, it.measure_qty, it.measure_units].every(v => v === null || v === undefined || v === '')
  if (none) return true
  const qty = Number(it.measure_qty), units = Number(it.measure_units)
  return typeof it.measure_key === 'string' && !!it.measure_key && Number.isInteger(qty) && qty >= 1
    && Number.isInteger(units) && units >= MIN_MEASURE_UNITS && units <= MAX_MEASURE_UNITS
    && Number(it.quantity) === qty * units
    && (it.measure_label === null || it.measure_label === undefined || (typeof it.measure_label === 'string' && it.measure_label.length <= MEASURE_LABEL_MAX))
}

// ── Affichage ─────────────────────────────────────────────────────────────────────────────────────────────────
type Tr = (key: string, values?: Record<string, string | number>) => string

/** Nom d'une mesure accordé au nombre (« 1 boîte », « 3 boîtes ») ; mesure libre : son libellé tel quel */
export function measureName(m: { key: string; label?: string | null }, count: number, tMeasure: Tr): string {
  if (m.key === 'custom') return cleanLabel(m.label)
  return tMeasure(`labels.${m.key}`, { count: Math.abs(Number(count)) || 1 })
}

/** Nombre lisible (2 décimales au plus, sans zéros inutiles) */
const decimal = (n: number, locale: string) => n.toLocaleString(locale, { maximumFractionDigits: 2 })

/** Quantité de stock lisible : grammes et millilitres passent au kilo et au litre dès 1 000 (« 37,5 kg ») */
export function stockAmount(qty: number, unit: string | null | undefined, locale = 'fr'): { value: string; unit: string; count: number } {
  const n = Number(qty) || 0
  const coarse = coarseUnitOf(unit)
  if (coarse && Math.abs(n) >= FINE_FACTOR) return { value: decimal(n / FINE_FACTOR, locale), unit: coarse, count: n / FINE_FACTOR }
  return { value: decimal(n, locale), unit: unit || 'piece', count: n }
}

/** Contenu d'une mesure, pour le stock : « environ 250 g », « environ 8 kg », « 24 pièces » (exact pour ce qui se compte,
 *  imposé pour le kilo et le litre) */
export function measureContent(m: { key: string; units: number }, baseUnit: string | null | undefined, unitLabel: (u: string, n?: number) => string, tMeasure: Tr, locale = 'fr'): string {
  const a = stockAmount(m.units, baseUnit, locale)
  const text = `${a.value} ${unitLabel(a.unit, a.count)}`
  if (fixedUnits(m.key, baseUnit) !== null) return text
  return isFineUnit(baseUnit) || baseUnit === 'kg' || baseUnit === 'litre' ? tMeasure('about', { amount: text }) : text
}

/** Ligne de vente enregistrée, vue « à la mesure » : 3 boîtes à 550 (null : vendue à l'unité de stock). Le prix d'une
 *  mesure est relu à partir du prix unitaire enregistré (prix ÷ contenu), arrondi au centime. */
export function soldMeasure(it: { unit_price?: unknown; measure_key?: unknown; measure_label?: unknown; measure_qty?: unknown; measure_units?: unknown }): { key: string; label: string | null; qty: number; units: number; price: number } | null {
  const qty = Number(it.measure_qty), units = Number(it.measure_units)
  if (!it.measure_key || !(qty >= 1) || !(units >= MIN_MEASURE_UNITS)) return null
  return { key: String(it.measure_key), label: it.measure_label ? String(it.measure_label) : null, qty, units, price: Math.round(Number(it.unit_price) * units * 100) / 100 }
}

/** Ligne de vente telle que la lisent le client et le caissier (ticket, reçu en ligne et PDF, WhatsApp, historique) :
 *  vendue à la mesure, elle devient « Riz · boîte », 3 au prix de la boîte (550), jamais 2 100 g à 0,79. Le
 *  sous-total ne change pas ; aucune économie n'est affichée (le prix d'une mesure est fixe). */
export function receiptView<T extends { product_name?: unknown; quantity?: unknown; unit_price?: unknown; original_price?: unknown; measure_key?: unknown; measure_label?: unknown; measure_qty?: unknown; measure_units?: unknown }>(it: T, tMeasure: Tr): T {
  const sm = soldMeasure(it)
  if (!sm) return it
  return { ...it, product_name: `${String(it.product_name ?? '')} · ${measureName(sm, 1, tMeasure)}`, quantity: sm.qty, unit_price: sm.price, original_price: null }
}

/** Prix d'une unité fine ramené au kilo ou au litre pour l'affichage (0,75 F le gramme → 750 F le kilo) ; autre unité :
 *  inchangé */
export const displayUnitPrice = (price: number, unit: string | null | undefined) => (isFineUnit(unit) ? Math.round(Number(price) * FINE_FACTOR * 100) / 100 : Number(price))
