// Étape 10 : emplacement dans l'import Excel des produits (1er nov. 2026) : npx tsx tests/e2e/location-import-pure.ts
import { checkRows, headerField, IMPORT_FIELDS } from '../../lib/import/products-import'

let ok = 0, ko = 0
const check = (label: string, cond: boolean, detail?: unknown) => { if (cond) { ok++; console.log('  ✓', label) } else { ko++; console.log('  ✗', label, detail ?? '') } }

check('« location » fait partie des champs importés', IMPORT_FIELDS.includes('location'))
for (const h of ['Emplacement', 'emplacement', 'Rayon', 'Location', 'Shelf', 'Wuri']) check(`en-tête « ${h} » → emplacement`, headerField(h) === 'location', headerField(h))
check('en-tête « Seuil d’alerte » reste le seuil', headerField('Seuil d’alerte') === 'low_stock_threshold')

const base = { name: 'Riz test emplacement', selling_price: '1000', quantity: '0', unit: 'pièce' }
const [a, b, c] = checkRows([
  { line: 2, values: { ...base, location: '  Rayon 3,   étagère B ' } },
  { line: 3, values: { ...base, name: 'Huile test emplacement', location: 'x'.repeat(61) } },
  { line: 4, values: { ...base, name: 'Sucre test emplacement' } },
], [])
check('emplacement importé, espaces resserrés', a.status === 'new' && a.product?.location === 'Rayon 3, étagère B', a)
check('61 caractères : ligne refusée « location_too_long »', b.status === 'error' && b.issue === 'location_too_long', b)
check('sans colonne Emplacement : produit importé sans emplacement', c.status === 'new' && c.product?.location === null, c)

console.log(`\n${ok} réussis, ${ko} échec(s)`)
process.exit(ko ? 1 : 0)
