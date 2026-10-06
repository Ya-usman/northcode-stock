// Import de produits (lot 1, 7 oct. 2026) — règles PARTAGÉES par l'aperçu et le
// serveur (une seule vérité) : reconnaissance des en-têtes (fr/en/ha, accents et
// astérisques ignorés), lecture des nombres « à la française » (1 500 · 1500,50
// · 1.500), unités en toutes lettres (pièce, sac, kwali…), doublons dans le
// fichier et avec le stock existant, lignes d'exemple des anciens modèles.
// Fonctions PURES : aucun accès à la base.

export const PRODUCT_UNITS = ['piece', 'kg', 'g', 'litre', 'ml', 'pack', 'carton', 'dozen', 'bag', 'bottle', 'tin', 'box'] as const
export type ProductUnit = typeof PRODUCT_UNITS[number]
export const IMPORT_MAX_ROWS = 1000

export type ImportField = 'name' | 'selling_price' | 'buying_price' | 'quantity' | 'unit' | 'sku' | 'low_stock_threshold'
export const IMPORT_FIELDS: ImportField[] = ['name', 'selling_price', 'buying_price', 'quantity', 'unit', 'sku', 'low_stock_threshold']

/** Texte comparable : minuscules, sans accents, sans ponctuation superflue ni espaces doubles */
export function normalizeText(s: unknown): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[’'`]/g, "'").replace(/[*:]/g, ' ').replace(/\s+/g, ' ').trim()
}

// En-têtes reconnus (après normalizeText) — modèles actuels et anciens, 3 langues
const HEADER_WORDS: Record<ImportField, string[]> = {
  name: ['name', 'nom', 'nom du produit', 'produit', 'designation', 'article', 'product', 'product name', 'suna', 'sunan kaya'],
  selling_price: ['selling_price', 'prix de vente', 'prix', 'pv', 'prix vente', 'selling price', 'price', 'sale price', 'farashin siyarwa', 'farashin sayarwa'],
  buying_price: ['buying_price', "prix d'achat", 'prix achat', 'pa', "cout d'achat", 'cout', 'buying price', 'cost', 'cost price', 'purchase price', 'farashin saya', 'farashin sayayya'],
  quantity: ['quantity', 'quantite', 'quantite en stock', 'qte', 'stock', 'qty', 'quantity in stock', 'yawa', 'adadi', 'adadi a hannu'],
  unit: ['unit', 'unite', 'unite (piece, kg, litre…)', 'unit (piece, kg, litre…)', 'naui', 'naui (piece, kg, litre…)', "ma'auni", 'mauni'],
  sku: ['sku', 'code-barres', 'code barres', 'code-barres / sku', 'sku / code-barres', 'code', 'reference', 'ref', 'barcode', 'barcode / sku', 'sku / barcode', 'lambar kaya', 'lambar barcode'],
  low_stock_threshold: ['low_stock_threshold', 'seuil stock faible', "seuil d'alerte", "seuil d'alerte stock", 'seuil', 'alerte', 'low stock threshold', 'alert threshold', 'reorder level', 'kananan hannun kaya', 'kananan hanawa', 'iyakar fadakarwa'],
}
const HEADER_INDEX = new Map<string, ImportField>()
for (const f of IMPORT_FIELDS) for (const w of HEADER_WORDS[f]) HEADER_INDEX.set(normalizeText(w), f)

/** Champ d'un en-tête de colonne, ou null s'il n'est pas reconnu */
export function headerField(header: unknown): ImportField | null {
  const h = normalizeText(header)
  if (!h) return null
  if (HEADER_INDEX.has(h)) return HEADER_INDEX.get(h)!
  // « Unité (pièce, kg…) » : on ignore la parenthèse
  const short = h.replace(/\s*\(.*\)\s*$/, '').trim()
  return HEADER_INDEX.get(short) ?? null
}

// Unités : libellés du modèle (3 langues) et façons courantes de les écrire
const UNIT_WORDS: Record<ProductUnit, string[]> = {
  piece: ['piece', 'pieces', 'pc', 'pcs', 'pce', 'unite', 'unites', 'u', 'unit', 'units', 'item', 'guda', 'pièce'],
  kg: ['kg', 'kgs', 'kilo', 'kilos', 'kilogramme', 'kilogrammes', 'kilogram', 'kilogramme(s)'],
  g: ['g', 'gr', 'gramme', 'grammes', 'gram', 'grams'],
  litre: ['litre', 'litres', 'l', 'lt', 'liter', 'liters', 'lita'],
  ml: ['ml', 'millilitre', 'millilitres', 'milliliter'],
  pack: ['pack', 'packs', 'paquet', 'paquets', 'sachet', 'sachets', 'fakiti'],
  carton: ['carton', 'cartons', 'ctn', 'kwali'],
  dozen: ['dozen', 'douzaine', 'douzaines', 'dz', 'dozin'],
  bag: ['bag', 'bags', 'sac', 'sacs', 'buhu'],
  bottle: ['bottle', 'bottles', 'bouteille', 'bouteilles', 'btl', 'kwalba'],
  tin: ['tin', 'tins', 'boite de conserve', 'conserve', 'can', 'gwangwani'],
  box: ['box', 'boxes', 'boite', 'boites', 'akwati'],
}
const UNIT_INDEX = new Map<string, ProductUnit>()
for (const u of PRODUCT_UNITS) for (const w of UNIT_WORDS[u]) UNIT_INDEX.set(normalizeText(w), u)

/** Unité de l'app ; vide → pièce ; inconnue → null */
export function parseUnit(v: unknown): ProductUnit | null {
  const s = normalizeText(v)
  if (!s) return 'piece'
  return UNIT_INDEX.get(s) ?? UNIT_INDEX.get(s.replace(/s$/, '')) ?? null
}

export interface ParsedNumber { value: number | null; ambiguous: boolean; invalid: boolean }

/** Nombre saisi dans Excel ou un CSV, quelle que soit la langue :
 *  1500 · 1 500 · 1500,50 · 1 500,50 · 1,500.50 · 1.500,50 · « 2 000 FCFA ».
 *  « 1.500 » ou « 1,500 » seuls : lus comme 1500 (milliers) et signalés. */
export function parseNumber(v: unknown): ParsedNumber {
  if (typeof v === 'number') return Number.isFinite(v) ? { value: v, ambiguous: false, invalid: false } : { value: null, ambiguous: false, invalid: true }
  let s = String(v ?? '').trim()
  if (!s) return { value: null, ambiguous: false, invalid: false }
  s = s.replace(/[\s  ]/g, '').replace(/(fcfa|cfa|xaf|xof|ngn|ghs|eur|usd|f|₦|€|\$|n)$/i, '').replace(/^(fcfa|cfa|xaf|xof|ngn|₦|€|\$)/i, '')
  if (!/^-?[\d.,]+$/.test(s)) return { value: null, ambiguous: false, invalid: true }
  let ambiguous = false
  const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.')
  if (lastComma >= 0 && lastDot >= 0) {
    // Les deux : le dernier est la virgule décimale
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? ',' : '.'
    const parts = s.split(sep)
    if (parts.length > 2 || (parts[1].length === 3 && parts[0].replace('-', '').length >= 1 && parts[0].replace('-', '') !== '0')) {
      // 1,500 · 1.500 · 1.500.000 : séparateur de milliers
      if (parts.length === 2) ambiguous = true
      if (!parts.slice(1).every(p => p.length === 3)) return { value: null, ambiguous: false, invalid: true }
      s = parts.join('')
    } else {
      s = parts.join('.') // 1500,5 · 12.75 : décimale
    }
  }
  const n = Number(s)
  return Number.isFinite(n) ? { value: n, ambiguous, invalid: false } : { value: null, ambiguous: false, invalid: true }
}

/** Code-barres : texte exact ; un nombre entier redevient texte ; « 5,90026E+12 » = abîmé par Excel */
export function parseSku(v: unknown): { value: string | null; damaged: boolean } {
  if (v === null || v === undefined || v === '') return { value: null, damaged: false }
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { value: null, damaged: true }
    return Number.isInteger(v) && v < Number.MAX_SAFE_INTEGER ? { value: String(v), damaged: false } : { value: null, damaged: true }
  }
  const s = String(v).trim()
  if (!s) return { value: null, damaged: false }
  if (/^\d+([.,]\d+)?e\+?\d+$/i.test(s)) return { value: null, damaged: true }
  return { value: s, damaged: false }
}

// Lignes d'exemple des ANCIENS modèles CSV (elles étaient dans la feuille à importer) :
// ignorées seulement si nom, prix de vente, prix d'achat et quantité sont ceux de
// l'exemple — un vrai produit du même nom reste importé. Les exemples du nouveau
// modèle sont dans l'onglet « Mode d'emploi », qui n'est jamais lu.
const EXAMPLES = new Set([
  ['coca cola 50cl', 200, 150, 100], ['sucre 1kg', 500, 380, 50], ['huile vegetale 1l', 900, 700, 30],
  ['sugar 1kg', 500, 380, 50], ['vegetable oil 1l', 900, 700, 30], ['sukari 1kg', 500, 380, 50], ['man ci 1l', 900, 700, 30],
].map(([n, s, b, q]) => `${normalizeText(n)}|${s}|${b}|${q}`))

export type RowIssue =
  | 'missing_name' | 'name_too_long' | 'missing_price' | 'invalid_price' | 'invalid_buying_price'
  | 'invalid_quantity' | 'invalid_threshold' | 'unknown_unit' | 'sku_damaged' | 'sku_too_long'
  | 'duplicate_in_file' | 'exists_name' | 'exists_sku' | 'example_row' | 'insert_failed'
export type RowWarning = 'buying_above_selling' | 'ambiguous_number'

export interface ImportProduct {
  name: string; selling_price: number; buying_price: number; quantity: number
  unit: ProductUnit; sku: string | null; low_stock_threshold: number | null
}
export interface RowReport {
  line: number
  status: 'new' | 'exists' | 'error' | 'ignored'
  issue?: RowIssue
  params?: Record<string, string | number>
  warnings: { code: RowWarning; params?: Record<string, string | number> }[]
  product?: ImportProduct
  /** Valeurs telles que lues (aperçu, lignes à corriger) */
  raw: Partial<Record<ImportField, unknown>>
}
export interface RawRow { line: number; values: Partial<Record<ImportField, unknown>> }

/** Rapport ligne par ligne. existing : produits actuels de la boutique (nom, code-barres). */
export function checkRows(rows: RawRow[], existing: { name: string; sku: string | null }[]): RowReport[] {
  const existingNames = new Map(existing.map(p => [normalizeText(p.name), p.name]))
  const existingSkus = new Map(existing.filter(p => p.sku).map(p => [String(p.sku).trim().toLowerCase(), p.name]))
  const seenNames = new Map<string, number>(), seenSkus = new Map<string, number>()

  return rows.map(({ line, values }) => {
    const r: RowReport = { line, status: 'error', warnings: [], raw: values }
    const fail = (issue: RowIssue, params?: Record<string, string | number>) => Object.assign(r, { status: 'error' as const, issue, params })
    const name = String(values.name ?? '').replace(/\s+/g, ' ').trim()
    if (!name) return fail('missing_name')
    if (name.length > 200) return fail('name_too_long')
    const sp = parseNumber(values.selling_price)
    const exampleKey = `${normalizeText(name)}|${sp.value}|${parseNumber(values.buying_price).value}|${parseNumber(values.quantity).value}`
    if (EXAMPLES.has(exampleKey)) return Object.assign(r, { status: 'ignored' as const, issue: 'example_row' as RowIssue })
    if (sp.invalid) return fail('invalid_price')
    if (sp.value === null) return fail('missing_price')
    if (!(sp.value > 0)) return fail('invalid_price')
    const bp = parseNumber(values.buying_price)
    if (bp.invalid || (bp.value !== null && bp.value < 0)) return fail('invalid_buying_price')
    const qt = parseNumber(values.quantity)
    if (qt.invalid || (qt.value !== null && (qt.value < 0 || !Number.isInteger(qt.value)))) return fail('invalid_quantity')
    const th = parseNumber(values.low_stock_threshold)
    if (th.invalid || (th.value !== null && (th.value < 0 || !Number.isInteger(th.value)))) return fail('invalid_threshold')
    const unit = parseUnit(values.unit)
    if (!unit) return fail('unknown_unit', { unit: String(values.unit) })
    const sku = parseSku(values.sku)
    if (sku.damaged) return fail('sku_damaged')
    if (sku.value && sku.value.length > 64) return fail('sku_too_long')

    for (const [p, raw] of [[sp, values.selling_price], [bp, values.buying_price], [qt, values.quantity], [th, values.low_stock_threshold]] as const) {
      if (p.ambiguous) r.warnings.push({ code: 'ambiguous_number', params: { raw: String(raw), value: p.value! } })
    }
    if (bp.value !== null && bp.value > sp.value) r.warnings.push({ code: 'buying_above_selling' })

    const key = normalizeText(name), skuKey = sku.value?.toLowerCase() ?? null
    r.product = {
      name, selling_price: sp.value, buying_price: bp.value ?? 0, quantity: qt.value ?? 0,
      unit, sku: sku.value, low_stock_threshold: th.value,
    }
    // Code-barres pris par un AUTRE produit du stock : à corriger (avant les doublons du
    // fichier : une ligne refusée ne doit pas faire refuser la suivante)
    const skuOwner = skuKey ? existingSkus.get(skuKey) : undefined
    if (skuOwner !== undefined && normalizeText(skuOwner) !== key) return fail('exists_sku', { name: skuOwner })

    const firstSame = seenNames.get(key) ?? (skuKey ? seenSkus.get(skuKey) : undefined)
    if (firstSame !== undefined) return fail('duplicate_in_file', { line: firstSame })
    seenNames.set(key, line); if (skuKey) seenSkus.set(skuKey, line)

    // Déjà en stock (même code-barres et même nom, ou même nom) : laissé tel quel
    if (skuOwner !== undefined) return Object.assign(r, { status: 'exists' as const, issue: 'exists_sku' as RowIssue, params: { name: skuOwner } })
    if (existingNames.has(key)) return Object.assign(r, { status: 'exists' as const, issue: 'exists_name' as RowIssue, params: { name: existingNames.get(key)! } })
    r.status = 'new'
    return r
  })
}

export function summarize(reports: RowReport[]) {
  return {
    total: reports.length,
    new: reports.filter(r => r.status === 'new').length,
    exists: reports.filter(r => r.status === 'exists').length,
    errors: reports.filter(r => r.status === 'error').length,
    ignored: reports.filter(r => r.status === 'ignored').length,
    warnings: reports.filter(r => r.warnings.length).length,
  }
}
