// Lot A des ajouts (1er nov. 2026) : création d'un produit côté serveur = liste fermée de champs + règles communes
// avec l'import (checkProductFields). Usage : npx tsx tests/e2e/new-product-pure.ts
import { newProductRow, sameNameProduct, checkProductPatch } from '../../lib/api/new-product'
import { lowStockThresholdOf } from '../../lib/stock/signals'
import { checkRows, checkProductFields } from '../../lib/import/products-import'

let ok = 0, ko = 0
const check = (label: string, cond: boolean, detail?: unknown) => { if (cond) { ok++; console.log('  ✓', label) } else { ko++; console.log('  ✗', label, detail ?? '') } }
const SHOP = 'a0000000-0000-0000-0000-000000000001'
const base = { shop_id: SHOP, name: 'Riz parfumé 5 kg', selling_price: 4500, buying_price: 3800, quantity: 12, unit: 'bag' }

console.log('1. Liste fermée de champs')
const forced = newProductRow({ ...base, track_serials: true, is_kit: true, promo_price: 1, is_active: false, id: 'x', created_at: '2020-01-01', shop_id: SHOP, quantity_reserved: 3 }, true)
check('création acceptée', forced.ok, forced)
if (forced.ok) {
  for (const k of ['track_serials', 'is_kit', 'promo_price', 'id', 'created_at', 'quantity_reserved']) check(`« ${k} » jamais fixé à la création`, !(k in forced.row), forced.row)
  check('toujours actif à la création', forced.row.is_active === true)
  check('champs gardés : nom, prix, quantité, unité, coût', forced.row.name === base.name && forced.row.selling_price === 4500 && forced.row.quantity === 12 && forced.row.unit === 'bag' && forced.row.buying_price === 3800, forced.row)
}
const noCost = newProductRow(base, false)
check('sans droit au coût : prix d’achat jamais écrit', noCost.ok && !('buying_price' in noCost.row), noCost)

console.log('\n2. Règles communes')
const refuse = (label: string, body: Record<string, unknown>, key: string, field?: string) => {
  const r = newProductRow({ ...base, ...body }, true)
  check(`${label} → ${key}`, !r.ok && r.key === key && (!field || r.field === field), r)
}
refuse('nom fait d’espaces', { name: '    ' }, 'product_name_required', 'name')
refuse('nom de 201 caractères', { name: 'x'.repeat(201) }, 'product_name_too_long', 'name')
refuse('prix de vente 0', { selling_price: 0 }, 'product_selling_price_invalid', 'selling_price')
refuse('prix de vente négatif', { selling_price: -5 }, 'product_selling_price_invalid', 'selling_price')
refuse('prix de vente absent', { selling_price: null }, 'product_selling_price_invalid', 'selling_price')
refuse('prix d’achat négatif', { buying_price: -1 }, 'product_buying_price_invalid', 'buying_price')
refuse('quantité 2,5', { quantity: 2.5 }, 'product_quantity_invalid', 'quantity')
refuse('quantité négative', { quantity: -3 }, 'product_quantity_invalid', 'quantity')
refuse('seuil négatif', { low_stock_threshold: -1 }, 'product_threshold_invalid', 'low_stock_threshold')
refuse('unité inconnue', { unit: 'tonneau' }, 'product_unit_invalid', 'unit')
refuse('code-barres de 65 caractères', { sku: 'A'.repeat(65) }, 'sku_too_long', 'sku')
refuse('code-barres GTIN faux', { sku: '5901234123458' }, 'barcode_invalid', 'sku')
refuse('emplacement de 61 caractères', { location: 'x'.repeat(61) }, 'location_too_long', 'location')
refuse('date de péremption impossible', { expiry_date: '2026-02-30' }, 'date_invalid', 'expiry_date')
const half = newProductRow({ ...base, selling_price: 0.5 }, true)
check('prix de vente 0,5 accepté (même règle que l’import)', half.ok && half.row.selling_price === 0.5, half)
const clean = newProductRow({ ...base, name: '  Riz   parfumé  ', sku: '  ', location: '  Rayon 2  ', unit: '' }, true)
check('nom resserré, code-barres vide = aucun, unité vide = pièce', clean.ok && clean.row.name === 'Riz parfumé' && clean.row.sku === null && clean.row.unit === 'piece' && clean.row.location === 'Rayon 2', clean)
const exp = newProductRow({ ...base, expiry_date: '2027-03-31' }, true)
check('péremption du lot initial gardée à part, jamais sur le produit', exp.ok && exp.expiry_date === '2027-03-31' && !('expiry_date' in exp.row), exp)
const gtin = newProductRow({ ...base, sku: '5901234123457' }, true)
check('GTIN valide accepté', gtin.ok && gtin.row.sku === '5901234123457', gtin)

console.log('\n3. Doublons de nom')
const list = [
  { id: '1', name: 'Riz Parfume 5 KG', is_active: false },
  { id: '2', name: 'Huile 1 L', is_active: true },
]
check('même nom sans casse ni accents, archivé → signalé archivé', sameNameProduct('riz parfumé 5 kg', list)?.id === '1')
check('nom différent → aucun doublon', sameNameProduct('Riz parfumé 25 kg', list) === null)
const both = [...list, { id: '3', name: 'riz parfumé 5 kg', is_active: true }]
check('actif et archivé du même nom → l’actif est signalé', sameNameProduct('Riz parfumé 5 kg', both)?.id === '3')

console.log('\n4. Import inchangé')
const rows = checkRows([
  { line: 2, values: { name: 'Coca Cola 50cl', selling_price: '200', buying_price: '150', quantity: '100' } },
  { line: 3, values: { name: 'Savon', selling_price: '300', buying_price: '400', quantity: '5' } },
  { line: 4, values: { name: 'savon', selling_price: '300' } },
  { line: 5, values: { name: '', selling_price: '300' } },
], [{ name: 'Huile 1 L', sku: null }])
check('ligne d’exemple des anciens modèles ignorée', rows[0].status === 'ignored' && rows[0].issue === 'example_row', rows[0])
check('achat > vente : avertissement, lot au coût donné', rows[1].status === 'new' && rows[1].warnings.some(w => w.code === 'buying_above_selling') && rows[1].lot?.cost === 400, rows[1])
check('doublon dans le fichier', rows[2].status === 'error' && rows[2].issue === 'duplicate_in_file', rows[2])
check('nom manquant', rows[3].status === 'error' && rows[3].issue === 'missing_name', rows[3])
const f = checkProductFields({ name: 'Lait', selling_price: '1 500', quantity: '0', expiry_date: '31/12/2027' })
check('checkProductFields : nombre « 1 500 », date du lot sans stock = avertissement', f.ok && f.product.selling_price === 1500 && f.warnings.some(w => w.code === 'expiry_without_stock'), f)

console.log('\n5. Lot C : archivés, saisie à la main, modification, seuil')
const arch = checkRows([{ line: 2, values: { name: 'riz parfume 5 kg', selling_price: '100' } }], [{ name: 'Riz parfumé 5 kg', sku: null, is_active: false }])
check('import : même nom qu’un produit archivé → « déjà dans vos produits archivés »', arch[0].status === 'exists' && arch[0].issue === 'exists_archived', arch[0])
const both2 = checkRows([{ line: 2, values: { name: 'Savon', selling_price: '100' } }], [{ name: 'Savon', sku: null, is_active: false }, { name: 'savon', sku: null, is_active: true }])
check('actif et archivé du même nom → « déjà en stock » (l’actif)', both2[0].issue === 'exists_name', both2[0])
const coca = checkRows([{ line: 1, values: { name: 'Coca Cola 50cl', selling_price: '200', buying_price: '150', quantity: '100' } }], [], undefined, { examples: false })
check('ajout rapide : « Coca Cola 50cl » 200/150/100 tapé à la main = produit nouveau', coca[0].status === 'new', coca[0])
const patch = (u: Record<string, unknown>) => { const c = { ...u }; return { r: checkProductPatch(c), c } }
check('modification : nom fait d’espaces refusé', patch({ name: '   ' }).r?.key === 'product_name_required')
check('modification : prix de vente 0 refusé', patch({ selling_price: 0 }).r?.key === 'product_selling_price_invalid')
check('modification : unité inconnue refusée', patch({ unit: 'tonneau' }).r?.key === 'product_unit_invalid')
check('modification : seuil 2,5 refusé', patch({ low_stock_threshold: 2.5 }).r?.key === 'product_threshold_invalid')
const empty = patch({ low_stock_threshold: '' }), zero = patch({ low_stock_threshold: 0 })
check('modification : seuil vide → null (seuil de la boutique), 0 → 0', !empty.r && empty.c.low_stock_threshold === null && !zero.r && zero.c.low_stock_threshold === 0)
check('modification : nom resserré', patch({ name: '  Riz   long ' }).c.name === 'Riz long')
check('seuil : vide → seuil de la boutique', lowStockThresholdOf({ low_stock_threshold: null }, 15) === 15)
check('seuil : vide, boutique sans seuil → 10', lowStockThresholdOf({ low_stock_threshold: null }, null) === 10)
check('seuil : 0 reste 0 (pas d’alerte stock bas)', lowStockThresholdOf({ low_stock_threshold: 0 }, 15) === 0)
check('seuil : nombre propre', lowStockThresholdOf({ low_stock_threshold: 4 }, 15) === 4)

console.log(`\n${ok} réussis, ${ko} échec(s)`)
process.exit(ko ? 1 : 0)
