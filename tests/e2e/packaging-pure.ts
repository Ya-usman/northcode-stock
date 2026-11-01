// Règles pures des conditionnements d'achat (étape 9 du Stock, 1er nov. 2026) : npx tsx tests/e2e/packaging-pure.ts
import { linePdfQuantity, lineQuantityText, packPriceToUnit, packToBase, roundUpToPacks, validPackInput } from '../../lib/products/packaging'

let ok = 0, ko = 0
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { ok++; console.log('  ✓', label) } else { ko++; console.log('  ✗', label, detail ?? '') }
}

const unitLabel = (u: string | null | undefined, n = 1) => ({ piece: n > 1 ? 'pièces' : 'pièce', carton: n > 1 ? 'cartons' : 'carton' } as Record<string, string>)[u || 'piece'] ?? String(u)
const tPack = (key: string, v: Record<string, string | number> = {}) =>
  key === 'pack_line' ? `${v.packs} ${v.pack} de ${v.count} (${v.total} ${v.base})` : key === 'pack_line_unit' ? `${v.pack} de ${v.count} (${v.total} ${v.base})` : key

check('3 cartons de 24 = 72', packToBase(3, 24) === 72)
check('colis négatif ou décimal : arrondi, jamais négatif', packToBase(-2, 24) === 0 && packToBase(2.4, 10) === 20)
check('prix du carton 12 000 / 24 = 500 par pièce', packPriceToUnit(12000, 24) === 500)
check('prix arrondi à 2 décimales', packPriceToUnit(1000, 3) === 333.33)
check('suggestion 50 avec carton de 24 : 3 cartons (72)', JSON.stringify(roundUpToPacks(50, 24)) === JSON.stringify({ packs: 3, base: 72 }))
check('suggestion exacte 48 : 2 cartons, pas 3', roundUpToPacks(48, 24).packs === 2)
check('suggestion 1 : au moins 1 colis', roundUpToPacks(1, 24).packs === 1 && roundUpToPacks(0, 24).packs === 1)
check('unité vide refusée', validPackInput('', 24) === 'packaging_invalid_unit')
check('1 unité par colis refusée (un colis contient au moins 2)', validPackInput('carton', 1) === 'packaging_invalid_units')
check('décimal refusé', validPackInput('carton', 2.5) === 'packaging_invalid_units')
check('au-delà de 100 000 refusé', validPackInput('carton', 100001) === 'packaging_invalid_units')
check('carton de 24 accepté', validPackInput('carton', 24) === null)
const packed = { quantity_ordered: 72, unit: 'piece', pack_unit: 'carton', units_per_pack: 24, pack_qty: 3 }
check('ligne en colis : « 3 cartons de 24 (72 pièces) »', lineQuantityText(packed, unitLabel, tPack) === '3 cartons de 24 (72 pièces)', lineQuantityText(packed, unitLabel, tPack))
check('ligne en unité de base : « 72 pièces »', lineQuantityText({ quantity_ordered: 72, unit: 'piece' }, unitLabel, tPack) === '72 pièces')
const pdf = linePdfQuantity(packed, unitLabel, tPack)
check('PDF en colis : quantité 3, unité « cartons de 24 (72 pièces) »', pdf.quantity === 3 && pdf.unit === 'cartons de 24 (72 pièces)', pdf)
const pdfBase = linePdfQuantity({ quantity_ordered: 5, unit: 'piece', pack_unit: null, units_per_pack: null, pack_qty: null }, unitLabel, tPack)
check('PDF en unité de base : 5 pièces', pdfBase.quantity === 5 && pdfBase.unit === 'pièces', pdfBase)

console.log(`\n${ok} réussis, ${ko} échec(s)`)
process.exit(ko ? 1 : 0)
