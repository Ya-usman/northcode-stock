// Prix de gros par paliers (migration 202, 2 nov. 2026) : règles pures partagées par la caisse, le formulaire, la revue
// des prix à la réception et le serveur. Usage : npx tsx tests/e2e/wholesale-pure.ts
import { linePrice, wholesaleFor, nextTier, tiersOf } from '../../lib/sales/pricing'
import { checkPriceTiers, newProductRow } from '../../lib/api/new-product'
import { normalizeTiers, tierPresets } from '../../lib/products/price-tiers'
import { priceReviewChanges, priceReviewProblem, initialPriceReview } from '../../components/stock/reception-prices'

let ok = 0, ko = 0
const check = (label: string, cond: boolean, detail?: unknown) => { if (cond) { ok++; console.log('  ✓', label) } else { ko++; console.log('  ✗', label, detail ?? '') } }
const NOW = '2026-11-02T12:00:00.000Z'
const riz = { selling_price: 500, price_tiers: [{ min_qty: 10, price: 480 }, { min_qty: 12, price: 470 }, { min_qty: 24, price: 450 }] }

console.log('1. Prix d’une ligne (meilleur palier atteint)')
check('9 pièces : détail', linePrice(riz, 9, null, NOW).price === 500 && !linePrice(riz, 9, null, NOW).wholesale)
check('10 pièces : dizaine (480)', linePrice(riz, 10, null, NOW).price === 480)
check('15 pièces : douzaine (470)', linePrice(riz, 15, null, NOW).price === 470)
check('24 pièces : carton (450)', linePrice(riz, 24, null, NOW).price === 450 && linePrice(riz, 24, null, NOW).wholesale)
check('100 pièces : meilleur palier (450)', wholesaleFor(riz, 100) === 450)
check('à 11 : prochain palier = douzaine, encore 1 pour 470', JSON.stringify(nextTier(riz, 11)) === JSON.stringify({ missing: 1, price: 470, min_qty: 12 }))
check('à 24 : aucun palier au-dessus', nextTier(riz, 24) === null)
const promo = { price: 460, until: '2026-12-01T00:00:00.000Z', start: null }
check('promo 460 : à 15 pièces la promo (460 < 470)', linePrice(riz, 15, promo, NOW).price === 460 && !linePrice(riz, 15, promo, NOW).wholesale)
check('promo 460 : à 24 pièces le carton (450 < 460)', linePrice(riz, 24, promo, NOW).price === 450 && linePrice(riz, 24, promo, NOW).wholesale)
check('paliers désordonnés en base : relus triés', tiersOf({ price_tiers: [{ min_qty: 24, price: 450 }, { min_qty: 12, price: 470 }] }).map(x => x.min_qty).join() === '12,24')
check('donnée abîmée (prix qui remonte) : aucun palier, jamais un prix au hasard', tiersOf({ price_tiers: [{ min_qty: 12, price: 450 }, { min_qty: 24, price: 470 }] }).length === 0)
check('produit sans paliers : détail', linePrice({ selling_price: 500 }, 100, null, NOW).price === 500 && nextTier({ selling_price: 500 } as any, 3) === null)

console.log('\n2. Règle de saisie commune')
const n = (raw: unknown, retail = 500) => normalizeTiers(raw, retail)
check('3 paliers acceptés, triés', (() => { const r = n([{ min_qty: 24, price: 450 }, { min_qty: '10', price: '480' }, { min_qty: 12, price: 470 }]); return r.ok && r.tiers?.map(x => x.min_qty).join() === '10,12,24' })())
check('lignes vides ignorées ; tout vide = aucun palier', (() => { const r = n([{ min_qty: '', price: '' }, { min_qty: null, price: null }]); return r.ok && r.tiers === null })())
check('4 paliers refusés', (() => { const r = n([{ min_qty: 2, price: 490 }, { min_qty: 3, price: 480 }, { min_qty: 4, price: 470 }, { min_qty: 5, price: 460 }]); return !r.ok && r.problem === 'too_many' })())
check('palier incomplet refusé', (() => { const r = n([{ min_qty: 12, price: '' }]); return !r.ok && r.problem === 'incomplete' })())
check('quantité 1 refusée', (() => { const r = n([{ min_qty: 1, price: 450 }]); return !r.ok && r.problem === 'min' })())
check('prix qui remonte refusé', (() => { const r = n([{ min_qty: 12, price: 450 }, { min_qty: 24, price: 460 }]); return !r.ok && r.problem === 'order' })())
check('même quantité deux fois refusée', (() => { const r = n([{ min_qty: 12, price: 450 }, { min_qty: 12, price: 440 }]); return !r.ok && r.problem === 'order' })())
check('premier palier au prix de détail refusé', (() => { const r = n([{ min_qty: 12, price: 500 }]); return !r.ok && r.problem === 'not_below' })())
check('serveur : clé de message', (() => { const u: Record<string, unknown> = { price_tiers: [{ min_qty: 12, price: 520 }] }; return checkPriceTiers(u, 500)?.key === 'product_wholesale_not_below_retail' })())
check('serveur : liste vide = null', (() => { const u: Record<string, unknown> = { price_tiers: [] }; return checkPriceTiers(u, 500) === null && u.price_tiers === null })())

console.log('\n3. Quantités tout prêtes')
check('sans colis : dizaine et douzaine', tierPresets(null).map(x => `${x.key}:${x.qty}`).join() === 'ten:10,dozen:12')
check('carton de 24 : + demi-carton (12 déjà « douzaine ») non dupliqué, + carton', tierPresets(24).map(x => `${x.key}:${x.qty}`).join() === 'ten:10,dozen:12,pack:24')
check('carton de 30 : + demi-carton 15, + carton 30', tierPresets(30).map(x => `${x.key}:${x.qty}`).join() === 'ten:10,dozen:12,half_pack:15,pack:30')

console.log('\n4. Création et revue à la réception')
const base = { shop_id: 'a0000000-0000-0000-0000-000000000001', name: 'Riz 1 kg', selling_price: 500, buying_price: 400, quantity: 0, unit: 'piece' }
const c1 = newProductRow({ ...base, price_tiers: [{ min_qty: 24, price: 450 }, { min_qty: 12, price: 470 }] }, true)
check('création : paliers triés', c1.ok && JSON.stringify(c1.row.price_tiers) === JSON.stringify([{ min_qty: 12, price: 470 }, { min_qty: 24, price: 450 }]), c1)
const c2 = newProductRow({ ...base, price_tiers: [{ min_qty: 12, price: 600 }] }, true)
check('création : palier au-dessus du détail refusé', !c2.ok && c2.key === 'product_wholesale_not_below_retail', c2)
const rev = initialPriceReview(riz)
check('réception : rien changé = rien envoyé', priceReviewChanges(riz, rev) === null)
const rev2 = { ...rev, tiers: rev.tiers.map((x, i) => (i === 2 ? { ...x, price: '440' } : x)) }
check('réception : carton à 440 = paliers renvoyés', JSON.stringify((priceReviewChanges(riz, rev2) as any)?.price_tiers?.[2]) === JSON.stringify({ min_qty: 24, price: 440 }))
check('réception : coût 455 > carton 450 = vente à perte à confirmer', priceReviewProblem(riz, rev, 455) === 'review_loss_unconfirmed' && priceReviewProblem(riz, { ...rev, lossConfirmed: true }, 455) === null)
check('réception : coût 300 = rien à confirmer', priceReviewProblem(riz, rev, 300) === null)

console.log(`\n${ok} réussis, ${ko} échec(s)`)
process.exit(ko ? 1 : 0)
