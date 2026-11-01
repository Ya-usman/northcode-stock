// Conditionnements d'achat (étape 9 du Stock, 1er nov. 2026) : règles pures partagées par le serveur et les écrans.
// Le stock reste en UNITÉ DE BASE ; un conditionnement (« carton de 24 ») ne sert qu'à saisir une entrée de stock et à
// l'écrire au fournisseur.

export interface Packaging {
  id: string
  product_id: string
  unit: string
  units_per_pack: number
  barcode: string | null
  is_default: boolean
}

/** Unités proposées pour un colis (sous-ensemble des unités produit, sans « pièce » ni les poids et volumes) */
export const PACK_UNITS = ['carton', 'pack', 'box', 'bag', 'dozen', 'bottle', 'tin'] as const

export const MAX_UNITS_PER_PACK = 100000

/** Quantité en unité de base pour N colis */
export function packToBase(packQty: number, unitsPerPack: number): number {
  return Math.max(0, Math.round(packQty)) * Math.max(1, Math.round(unitsPerPack))
}

/** Prix d'une unité de base à partir du prix d'un colis (2 décimales) */
export function packPriceToUnit(packPrice: number, unitsPerPack: number): number {
  return Math.round((packPrice / Math.max(1, unitsPerPack)) * 100) / 100
}

/** Arrondit une quantité de base au nombre de colis complets supérieur (réapprovisionnement) */
export function roundUpToPacks(baseQty: number, unitsPerPack: number): { packs: number; base: number } {
  const u = Math.max(1, Math.round(unitsPerPack))
  const packs = Math.max(1, Math.ceil(Math.max(0, baseQty) / u))
  return { packs, base: packs * u }
}

export function validPackInput(unit: unknown, unitsPerPack: unknown): string | null {
  const u = String(unit ?? '').trim()
  const n = Number(unitsPerPack)
  if (!u || u.length > 30) return 'packaging_invalid_unit'
  if (!Number.isInteger(n) || n < 2 || n > MAX_UNITS_PER_PACK) return 'packaging_invalid_units'
  return null
}

/** Ligne de bon de commande avec ses colis figés (195) ; colonnes de colis vides quand la ligne est en unité de base */
export interface PackedLine { quantity_ordered: number; unit: string | null; pack_unit?: string | null; units_per_pack?: number | null; pack_qty?: number | null }
type Tr = (key: string, values?: Record<string, string | number>) => string
type UnitLabel = (unit: string | null | undefined, count?: number) => string

/** « 3 cartons de 24 (72 pièces) » ; sinon « 72 pièces ». `tPack` traduit les clés de « packaging ». */
export function lineQuantityText(it: PackedLine, unitLabel: UnitLabel, tPack: Tr): string {
  const base = unitLabel(it.unit || 'piece', it.quantity_ordered)
  if (it.pack_qty && it.units_per_pack && it.pack_unit) {
    return tPack('pack_line', { packs: it.pack_qty, pack: unitLabel(it.pack_unit, it.pack_qty), count: it.units_per_pack, total: it.quantity_ordered, base })
  }
  return `${it.quantity_ordered} ${base}`.trim()
}

/** Pour la colonne « Quantité » du PDF (nombre + texte) : { quantity, unit } */
export function linePdfQuantity(it: PackedLine, unitLabel: UnitLabel, tPack: Tr): { quantity: number; unit: string } {
  if (it.pack_qty && it.units_per_pack && it.pack_unit) {
    return { quantity: it.pack_qty, unit: tPack('pack_line_unit', { pack: unitLabel(it.pack_unit, it.pack_qty), count: it.units_per_pack, total: it.quantity_ordered, base: unitLabel(it.unit || 'piece', it.quantity_ordered) }) }
  }
  return { quantity: it.quantity_ordered, unit: unitLabel(it.unit, it.quantity_ordered) }
}
