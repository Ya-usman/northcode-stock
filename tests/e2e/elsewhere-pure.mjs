// « Disponible ailleurs » (30 oct. 2026) : règles pures lib/stock/elsewhere (rapprochement des produits entre
// boutiques, ordre d'affichage, quantité proposée). Usage : node tests/e2e/elsewhere-pure.mjs
import { register } from 'node:module'

const ROOT = new URL('../../', import.meta.url)
register('data:text/javascript,' + encodeURIComponent(`
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
const ROOT = ${JSON.stringify(ROOT.href)}
export async function resolve(spec, ctx, next) {
  if (spec.startsWith('@/')) {
    for (const ext of ['.ts', '.tsx', '/index.ts']) {
      const u = new URL(spec.slice(2) + ext, ROOT)
      if (existsSync(fileURLToPath(u))) return { url: u.href, shortCircuit: true, format: 'module' }
    }
  }
  return next(spec, ctx)
}
`))
let pass = 0, fail = 0
const ok = (c, m, x) => { c ? pass++ : fail++; console.log((c ? 'ok    ' : 'ÉCHEC ') + m + (!c && x !== undefined ? ' → ' + JSON.stringify(x) : '')) }
const E = await import(new URL('lib/stock/elsewhere.ts', ROOT).href)

console.log('Clés')
ok(E.nameKey('  Coca-Cola  50 cl ') === 'coca-cola 50 cl' && E.nameKey('Crème Nivéa') === 'creme nivea', 'nom : sans accents, casse ni espaces en trop')
ok(E.skuKey(' 5449000000996 ') === '5449000000996' && E.skuKey(null) === '', 'code-barres : nettoyé')

console.log('\nRapprochement')
const P = (id, shop, name, sku = null) => ({ id, shop_id: shop, name, sku })
const idx = E.buildProductIndex([
  P('b1', 'B', 'Coca-Cola 50 cl', '5449000000996'),
  P('b2', 'B', 'Riz 5 kg'),
  P('b3', 'B', 'Savon'), P('b4', 'B', 'savon'),
  P('b5', 'B', 'Huile', 'DUP'), P('b6', 'B', 'Huile 2', 'DUP'),
  P('c1', 'C', 'coca-cola 50 CL'),
])
ok(E.matchIn(idx, 'B', { name: 'Autre nom', sku: '5449000000996' }) === 'b1', 'même code-barres → rattaché (même si le nom diffère)')
ok(E.matchIn(idx, 'B', { name: 'Riz 5 kg', sku: null }) === 'b2', 'sans code-barres : nom exact')
ok(E.matchIn(idx, 'B', { name: 'riz 5 KG', sku: 'INCONNU' }) === 'b2', 'code-barres inconnu dans la boutique : retombe sur le nom')
ok(E.matchIn(idx, 'B', { name: 'Savon', sku: null }) === null, 'deux produits au même nom : ambigu, non rattaché')
ok(E.matchIn(idx, 'B', { name: 'Huile', sku: 'DUP' }) === null, 'code-barres porté par deux produits : ambigu, PAS de repli sur le nom')
ok(E.matchIn(idx, 'C', { name: 'Coca-Cola 50 cl', sku: '5449000000996' }) === 'c1', 'autre boutique sans ce code-barres : nom exact')
ok(E.matchIn(idx, 'D', { name: 'Coca-Cola 50 cl', sku: null }) === null, 'boutique sans le produit : rien')

console.log('\nOrdre et quantité proposée')
const S = (id, open, available, name = id) => ({ shop_id: id, name, city: null, phone: null, open, closes_at: null, source_product_id: 'x', available, pending: 0 })
const sorted = E.sortElsewhere([S('a', false, 50), S('b', true, 3), S('c', true, 12), S('d', true, 12, 'Akwa')])
ok(sorted.map(s => s.shop_id).join(',') === 'd,c,b,a', 'ouvertes d\'abord, puis la plus grande quantité, puis le nom', sorted.map(s => s.shop_id))
ok(E.defaultRequestQty({ available: 12, threshold: 10, localAvailable: 0 }) === 10, 'rupture : de quoi revenir au seuil (10)')
ok(E.defaultRequestQty({ available: 4, threshold: 10, localAvailable: 0 }) === 4, 'plafonnée à ce que l\'autre boutique a (4)')
ok(E.defaultRequestQty({ available: 12, threshold: 10, localAvailable: 8 }) === 2, 'stock faible (8/10) : 2')
ok(E.defaultRequestQty({ available: 12, threshold: 0, localAvailable: 0 }) === 1, 'sans seuil : 1')
ok(E.defaultRequestQty({ available: 12, threshold: 5, localAvailable: 20 }) === 1, 'déjà au-dessus du seuil : 1 (jamais 0)')

console.log(`\n${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
