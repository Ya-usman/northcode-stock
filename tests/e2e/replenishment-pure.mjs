// Réapprovisionnement (étape 12, décisions du 30 oct. 2026) : règle pure lib/stock/replenishment.
// Usage : node tests/e2e/replenishment-pure.mjs
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
const R = await import(new URL('lib/stock/replenishment.ts', ROOT).href)

const F = (o = {}) => ({ available: 0, onOrder: 0, inTransit: 0, drafted: 0, threshold: 10, sold30: null, ...o })

console.log('Horizon')
ok(R.normalizeHorizon(60) === 60 && R.normalizeHorizon('15') === 15 && R.normalizeHorizon(45) === 30 && R.normalizeHorizon(undefined) === 30, 'horizon : 15 / 30 / 60, sinon 30')

console.log('\nStock prévu et rythme')
ok(R.projectedStock(F({ available: 3, onOrder: 10, inTransit: 2, drafted: 5 })) === 20, 'stock prévu = disponible + en commande + en transit + brouillons')
ok(R.projectedStock(F({ available: -4, onOrder: -1 })) === 0, 'valeurs négatives ignorées')
ok(R.dailySales(null) === null && R.dailySales(2) === null && R.dailySales(3) === 0.1 && R.dailySales(60) === 2, 'rythme : null sous 3 ventes / 30 j, sinon ventes / 30')
ok(R.dailySales(NaN) === null && R.dailySales(Infinity) === null, 'rythme : NaN / Infinity → null')

console.log('\nBesoin')
let n = R.replenishNeed(F({ available: 0 }))
ok(n.needed && n.reason === 'out', 'rupture → à commander (out)')
n = R.replenishNeed(F({ available: 8 }))
ok(n.needed && n.reason === 'low', 'sous le seuil → à commander (low)')
n = R.replenishNeed(F({ available: 4, onOrder: 20 }))
ok(!n.needed && n.reason === null, 'déjà commandé (prévu 24 > seuil 10, sans ventes) → rien à commander (pas de double commande)')
n = R.replenishNeed(F({ available: 4, drafted: 20 }))
ok(!n.needed, 'déjà dans un brouillon → rien à commander')
n = R.replenishNeed(F({ available: 4, inTransit: 20 }))
ok(!n.needed, 'transfert en route suffisant → rien à commander')
n = R.replenishNeed(F({ available: 20, sold30: 90 }))
ok(n.needed && n.reason === 'coverage' && n.daily === 3 && n.coverageDays === 6, 'au-dessus du seuil mais 6 jours de ventes (< 7) → couverture faible', n)
n = R.replenishNeed(F({ available: 24, sold30: 90 }))
ok(!n.needed && n.coverageDays === 8, '8 jours de ventes, sans délai → rien')
n = R.replenishNeed(F({ available: 24, sold30: 90 }), 5)
ok(n.needed && n.reason === 'coverage', '8 jours de ventes mais fournisseur à 5 jours (< 12) → à commander')
n = R.replenishNeed(F({ available: 11, sold30: 2 }))
ok(!n.needed && n.daily === null && n.coverageDays === null, 'peu de ventes : seule la règle du seuil (11 > 10 → rien)')
n = R.replenishNeed(F({ available: 10 }))
ok(n.needed && n.reason === 'low', 'au seuil exactement → à commander')
n = R.replenishNeed(F({ available: 0, onOrder: 5 }))
ok(n.needed && n.reason === 'out', 'rupture avec un peu en commande (5 ≤ seuil) → toujours à commander, motif rupture')

console.log('\nQuantité suggérée')
ok(R.suggestedQty(F({ available: 0 }), { horizon: 30 }) === 20, 'sans ventes : 2 × seuil − prévu = 20')
ok(R.suggestedQty(F({ available: 4, onOrder: 3 }), { horizon: 30 }) === 13, 'déduit ce qui est déjà en commande (20 − 7 = 13)')
ok(R.suggestedQty(F({ available: 6, sold30: 90 }), { horizon: 30 }) === 84, 'avec ventes : 3 / j × 30 j = 90 − 6 = 84')
ok(R.suggestedQty(F({ available: 6, sold30: 90 }), { horizon: 30, leadDays: 5 }) === 99, 'délai 5 j en plus : 3 × 35 = 105 − 6 = 99')
ok(R.suggestedQty(F({ available: 6, sold30: 90 }), { horizon: 15 }) === 39 && R.suggestedQty(F({ available: 6, sold30: 90 }), { horizon: 60 }) === 174, 'horizon 15 → 39, 60 → 174')
ok(R.suggestedQty(F({ available: 0, sold30: 3, threshold: 10 }), { horizon: 30 }) === 20, 'rythme faible (3 / 30 j = 3 pour 30 j) : au moins 2 × seuil = 20')
ok(R.suggestedQty(F({ available: 500, threshold: 10 }), { horizon: 30 }) === 1, 'jamais moins de 1 (demande explicite d’un produit bien fourni)')
ok(R.suggestedQty(F({ available: 0, sold30: 7 }), { horizon: 30 }) === 20, 'arrondi au supérieur, pas de décimale')
ok(Number.isInteger(R.suggestedQty(F({ available: 1, sold30: 31 }), { horizon: 15, leadDays: 2.6 })), 'résultat entier même avec un délai décimal')
ok(R.suggestedQty(F({ available: 0, sold30: 30 }), { horizon: 30, leadDays: 999 }) === 210, 'délai plafonné à 180 jours (1 / j × 210)')

console.log('\nDélai constaté')
const d = (days) => new Date(Date.UTC(2026, 9, 1) + days * 86400000).toISOString()
const obs = R.observedLeadDays([
  { supplier_id: 'A', sent_at: d(0), received_at: d(3) },
  { supplier_id: 'A', sent_at: d(10), received_at: d(15) },
  { supplier_id: 'A', sent_at: d(20), received_at: d(24) },
  { supplier_id: 'B', sent_at: d(0), received_at: d(2) },
  { supplier_id: 'C', sent_at: d(0), received_at: d(2.2) },
  { supplier_id: 'C', sent_at: d(5), received_at: d(7.1) },
  { supplier_id: 'D', sent_at: d(5), received_at: d(2) },
  { supplier_id: 'D', sent_at: null, received_at: d(2) },
  { supplier_id: null, sent_at: d(0), received_at: d(1) },
])
ok(obs.A === 4, 'médiane de 3 / 5 / 4 jours = 4', obs)
ok(!('B' in obs), 'un seul bon reçu → pas de délai constaté')
ok(obs.C === 3, 'médiane 2,15 j arrondie au supérieur = 3', obs)
ok(!('D' in obs), 'dates incohérentes ou manquantes ignorées')
ok(JSON.stringify(R.leadTimeOf(5, 9)) === JSON.stringify({ days: 5, source: 'declared' }), 'délai déclaré prioritaire')
ok(JSON.stringify(R.leadTimeOf(null, 9)) === JSON.stringify({ days: 9, source: 'observed' }), 'sinon délai constaté')
ok(R.leadTimeOf(null, undefined) === null, 'sinon inconnu')
ok(JSON.stringify(R.leadTimeOf(0, 9)) === JSON.stringify({ days: 0, source: 'declared' }), 'délai déclaré 0 jour respecté')

console.log('\nMeilleures offres (proposées, jamais appliquées)')
const O = (id, price, lead, at = '2026-10-12T10:00:00Z') => ({ supplierId: id, price, priceAt: price == null ? null : at, leadDays: lead })
let b = R.bestOffers([O('U', 5000, 5), O('X', 4500, 7), O('Y', 4800, 2)], 'U')
ok(b.cheaper?.supplierId === 'X' && b.faster?.supplierId === 'Y', 'moins cher : X (4 500 < 5 000) ; plus rapide : Y (2 < 5 j)', b)
b = R.bestOffers([O('U', 4000, 2), O('X', 4500, 7)], 'U')
ok(b.cheaper === null && b.faster === null, 'habituel déjà le moins cher et le plus rapide → aucune mention')
b = R.bestOffers([O('U', null, null), O('X', 4500, 3)], 'U')
ok(b.cheaper === null && b.faster === null, 'prix / délai du fournisseur habituel inconnus → pas de comparaison affirmée')
b = R.bestOffers([O('U', 5000, 5), O('X', 5000, 5)], 'U')
ok(b.cheaper === null && b.faster === null, 'égalité → aucune mention')
b = R.bestOffers([O('X', 4500, 7), O('Y', 4800, 2)], null)
ok(b.cheaper?.supplierId === 'X' && b.faster?.supplierId === 'Y', 'sans fournisseur habituel : meilleure offre de chaque sorte')
b = R.bestOffers([O('U', 5000, 5), O('X', 0, 1)], 'U')
ok(b.cheaper === null && b.faster?.supplierId === 'X', 'prix 0 jamais « moins cher »')

console.log('\nTout au moins cher')
const ch = R.cheapestChoice([
  { key: 'p1', supplierId: 'U', offers: [O('U', 5000, 5), O('X', 4500, 7)] },
  { key: 'p2', supplierId: 'U', offers: [O('U', 4000, 5), O('X', 4500, 7)] },
  { key: 'p3', supplierId: null, offers: [O('X', 4500, 7), O('Y', 4200, 1)] },
  { key: 'p4', supplierId: 'U', offers: [O('U', null, 5)] },
])
ok(ch.p1 === 'X' && ch.p2 === 'U' && ch.p3 === 'Y' && ch.p4 === 'U', 'bascule seulement là où un prix plus bas est connu', ch)

console.log('\nDate de livraison prévue')
ok(R.expectedDeliveryDate('2026-10-30', 5) === '2026-11-04', '30/10 + 5 j = 04/11')
ok(R.expectedDeliveryDate('2026-12-30', 3) === '2027-01-02', 'passage d’année')
ok(R.expectedDeliveryDate('2026-10-30', null) === null && R.expectedDeliveryDate('2026-10-30', 0) === null, 'sans délai : pas de date')

console.log(`\n${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
