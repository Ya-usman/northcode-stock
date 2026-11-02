// Mesures de vente (migration 203, 2 nov. 2026) : règles pures partagées par le formulaire, la caisse et le serveur.
// Usage : npx tsx tests/e2e/sale-measures-pure.ts
import {
  normalizeMeasures, measuresOf, findMeasure, soldOnlyByMeasures, measureUnitPrice, measureLineFields, validMeasureLine,
  stockAmount, measureContent, measureName, soldMeasure, receiptView, fixedUnits, displayUnitPrice,
} from '../../lib/products/sale-measures'
import { validateSale, validateLinePrices } from '../../lib/api/sale-validation'
import { revalidateHeldCart } from '../../lib/utils/held-sales'
import { computeTotals } from '../../lib/sales/pricing'

let ok = 0, ko = 0
const check = (label: string, cond: boolean, detail?: unknown) => { if (cond) { ok++; console.log('  ✓', label) } else { ko++; console.log('  ✗', label, detail === undefined ? '' : JSON.stringify(detail)) } }
const fr = require('../../messages/fr.json')
// Traducteur minimal (ICU pluriel one/other) pour l'espace « measures »
const tM = (key: string, v?: Record<string, string | number>) => {
  let s: string = key.split('.').reduce((o: any, k) => o?.[k], fr.measures) ?? key
  const m = s.match(/^\{count, plural, one \{(.*)\} other \{(.*)\}\}$/)
  if (m) s = Number(v?.count) === 1 ? m[1] : m[2]
  for (const [k, val] of Object.entries(v || {})) s = s.replace(`{${k}}`, String(val))
  return s
}
const unitLabel = (u: string, n = 1) => {
  const raw: string = fr.unit_labels[u] ?? u
  const m = raw.match(/^\{count, plural, one \{(.*)\} other \{(.*)\}\}$/)
  return m ? (Math.abs(n) === 1 ? m[1] : m[2]) : raw
}

;(async () => {
  console.log('1. Saisie des mesures (même règle que valid_sale_measures)')
  const riz = [{ key: 'glass', units: 250, price: 200 }, { key: 'box', units: 700, price: 550 }, { key: 'bucket', units: 8000, price: 6500 }]
  const r1 = normalizeMeasures([riz[2], riz[0], { key: null, units: null, price: null }, riz[1]], 'g')
  check('lignes vides ignorées, rangées par contenu (verre, boîte, seau)', r1.ok && r1.measures!.map(m => m.key).join() === 'glass,box,bucket', r1)
  check('aucune mesure : null', (() => { const r = normalizeMeasures([], 'g'); return r.ok && r.measures === null })())
  check('null : null', (() => { const r = normalizeMeasures(null, 'g'); return r.ok && r.measures === null })())
  const prob = (raw: unknown, unit = 'g') => { const r = normalizeMeasures(raw, unit); return r.ok ? 'ok' : r.problem }
  check('6 mesures : too_many', prob(Array.from({ length: 6 }, (_, i) => ({ key: 'custom', label: `M${i}`, units: 2 + i, price: 10 }))) === 'too_many')
  check('prix manquant : incomplete', prob([{ key: 'glass', units: 250 }]) === 'incomplete')
  check('mesure inconnue : key', prob([{ key: 'barrel', units: 250, price: 10 }]) === 'key')
  check('mesure libre sans nom : label', prob([{ key: 'custom', label: '  ', units: 250, price: 10 }]) === 'label')
  check('mesure libre de 21 caractères : label', prob([{ key: 'custom', label: 'x'.repeat(21), units: 250, price: 10 }]) === 'label')
  check('prix 0 : price', prob([{ key: 'glass', units: 250, price: 0 }]) === 'price')
  check('contenu 1 : units', prob([{ key: 'glass', units: 1, price: 10 }]) === 'units')
  check('contenu 2,5 : units', prob([{ key: 'glass', units: 2.5, price: 10 }]) === 'units')
  check('contenu 100 001 : units', prob([{ key: 'bag', units: 100001, price: 10 }]) === 'units')
  check('deux verres : duplicate', prob([riz[0], { ...riz[0], price: 300 }]) === 'duplicate')
  check('« Mudu » et « mudu » : duplicate', prob([{ key: 'custom', label: 'Mudu', units: 1500, price: 900 }, { key: 'custom', label: ' mudu ', units: 1600, price: 950 }]) === 'duplicate')
  check('deux mesures libres différentes : ok', prob([{ key: 'custom', label: 'Mudu', units: 1500, price: 900 }, { key: 'custom', label: 'Tiya', units: 2500, price: 1400 }]) === 'ok')
  check('kilo d’un produit en grammes : 1 000 imposé', fixedUnits('kg', 'g') === 1000 && prob([{ key: 'kg', units: 900, price: 500 }]) === 'fixed' && prob([{ key: 'kg', units: 1000, price: 500 }]) === 'ok')
  check('demi-kilo : 500 g ; litre d’un produit en ml : 1 000', fixedUnits('half_kg', 'g') === 500 && fixedUnits('litre', 'ml') === 1000)
  check('pack de 6 d’un produit à la pièce : libre', fixedUnits('pack', 'piece') === null && prob([{ key: 'pack', units: 6, price: 1200 }], 'piece') === 'ok')
  const r2 = normalizeMeasures([{ key: 'glass', label: 'ignoré', units: 250, price: 200 }], 'g')
  check('libellé retiré d’une mesure de la liste', r2.ok && !('label' in r2.measures![0]))
  check('mesures d’un produit lu en base : donnée abîmée = aucune', measuresOf({ sale_measures: [{ key: 'glass', units: 1, price: 1 }] }).length === 0 && measuresOf({ sale_measures: riz }).length === 3)
  check('trouver « Mudu » sans la casse', !!findMeasure({ sale_measures: [{ key: 'custom', label: 'Mudu', units: 1500, price: 900 }] }, 'custom', 'MUDU'))
  check('vendu uniquement par mesures : grammes avec mesures', soldOnlyByMeasures({ unit: 'g', sale_measures: riz }) && !soldOnlyByMeasures({ unit: 'piece', sale_measures: [{ key: 'pack', units: 6, price: 1200 }] }) && !soldOnlyByMeasures({ unit: 'g', sale_measures: null }))

  console.log('\n2. Ligne de vente à la mesure')
  const box = { key: 'box' as const, units: 700, price: 550 }
  const l3 = measureLineFields(box, 3)
  check('3 boîtes : 2 100 g, 1 650 F', l3.quantity === 2100 && l3.subtotal === 1650 && l3.measure_qty === 3 && l3.measure_units === 700, l3)
  check('prix unitaire : 550 ÷ 700 à 8 décimales', l3.unit_price === measureUnitPrice(550, 700) && Math.abs(l3.unit_price * 700 - 550) < 0.00001)
  for (const [m, n] of [[{ key: 'glass' as const, units: 250, price: 200 }, 7], [{ key: 'bucket' as const, units: 8000, price: 6500 }, 13], [{ key: 'custom' as const, label: 'Mudu', units: 1500, price: 975 }, 9], [{ key: 'bag' as const, units: 50000, price: 32500 }, 2], [{ key: 'pack' as const, units: 6, price: 1150 }, 17]] as const) {
    const f = measureLineFields(m as any, n as number)
    check(`${n} × ${m.key} : total exact (${(m.price as number) * (n as number)})`, f.subtotal === (m.price as number) * (n as number) && computeTotals([f], 0, 0).total === (m.price as number) * (n as number), f)
  }
  check('ligne cohérente', validMeasureLine(l3) && l3.quantity === 2100)
  check('quantité ≠ nombre × contenu : refusée', !validMeasureLine({ ...l3, quantity: 2000 }))
  check('mesure incomplète : refusée', !validMeasureLine({ quantity: 2100, measure_key: 'box', measure_qty: 3 }))
  check('ligne sans mesure : acceptée', validMeasureLine({ quantity: 5 }))
  check('libellé de 21 caractères : refusé', !validMeasureLine({ ...l3, measure_label: 'x'.repeat(21) }))

  console.log('\n3. Affichage')
  check('37 500 g → 37,5 kg', (() => { const a = stockAmount(37500, 'g'); return a.value === '37,5' && a.unit === 'kg' })())
  check('800 g reste en g', (() => { const a = stockAmount(800, 'g'); return a.value === '800' && a.unit === 'g' })())
  check('1 500 ml → 1,5 litre', (() => { const a = stockAmount(1500, 'ml'); return a.value === '1,5' && a.unit === 'litre' })())
  check('prix au gramme affiché au kilo : 0,75 → 750 ; à la pièce inchangé', displayUnitPrice(0.75, 'g') === 750 && displayUnitPrice(0.0035, 'ml') === 3.5 && displayUnitPrice(250, 'piece') === 250)
  check('24 pièces restent 24 pièces', (() => { const a = stockAmount(24, 'piece'); return a.value === '24' && a.unit === 'piece' })())
  check('contenu « environ 700 g »', measureContent(box, 'g', unitLabel, tM) === 'environ 700 g', measureContent(box, 'g', unitLabel, tM))
  check('contenu « environ 8 kg »', measureContent({ key: 'bucket', units: 8000 }, 'g', unitLabel, tM) === 'environ 8 kg')
  check('kilo : « 1 kg » (fixe, sans « environ »)', measureContent({ key: 'kg', units: 1000 }, 'g', unitLabel, tM) === '1 kg')
  check('carton : « 24 pièces » (exact)', measureContent({ key: 'pack', units: 24 }, 'piece', unitLabel, tM) === '24 pièces')
  check('nom accordé : 1 boîte, 3 boîtes, 2 seaux', measureName(box, 1, tM) === 'boîte' && measureName(box, 3, tM) === 'boîtes' && measureName({ key: 'bucket' }, 2, tM) === 'seaux')
  check('mesure libre : son nom', measureName({ key: 'custom', label: 'Mudu' }, 3, tM) === 'Mudu')
  const saved = { product_name: 'Riz', quantity: 2100, unit_price: measureUnitPrice(550, 700), subtotal: 1650, original_price: measureUnitPrice(550, 700), measure_key: 'box', measure_label: null, measure_qty: 3, measure_units: 700 }
  const sm = soldMeasure(saved)
  check('ligne enregistrée relue : 3 boîtes à 550', !!sm && sm.qty === 3 && sm.price === 550, sm)
  const view = receiptView(saved, tM)
  check('reçu : « Riz · boîte », 3 à 550, sous-total inchangé, aucune économie', view.product_name === 'Riz · boîte' && view.quantity === 3 && view.unit_price === 550 && view.subtotal === 1650 && view.original_price === null, view)
  check('reçu : jamais « de 3 verres » ni de grammes', !/verre|2100|2 100|g\b/.test(`${view.product_name} ${view.quantity}`))
  check('ligne sans mesure : inchangée', receiptView({ product_name: 'Savon', quantity: 2, unit_price: 300 }, tM).product_name === 'Savon')

  console.log('\n4. Contrôle serveur (lib/api/sale-validation)')
  const PRODUCT = { id: 'p1', name: 'Riz', selling_price: 1, promo_price: null, promo_until: null, promo_start: null, price_tiers: null, sale_measures: riz }
  const admin = {
    from: (table: string) => {
      const chain: any = { _t: table }
      for (const k of ['select', 'eq', 'in', 'gt', 'order']) chain[k] = () => chain
      chain.maybeSingle = async () => ({ data: { tax_rate: 0 } })
      chain.then = (res: any) => res(table === 'products' ? { data: [PRODUCT], error: null } : { data: [], error: null })
      return chain
    },
  }
  const line = (n: number, m = box, extra: Record<string, unknown> = {}) => ({ product_id: 'p1', ...measureLineFields(m, n), ...extra })
  const sale = async (items: any[]) => {
    const subtotal = computeTotals(items, 0, 0).subtotal
    return validateSale(admin, 'shop', items, { subtotal, discount: 0, tax: 0, total: subtotal }, { discountAllowed: false })
  }
  check('3 boîtes à 550 : acceptée', (await sale([line(3)])).ok)
  check('boîte + seau du même produit : acceptée', (await sale([line(2), line(1, riz[2] as any)])).ok)
  const low = await sale([{ ...line(3), unit_price: measureUnitPrice(500, 700) }])
  check('boîte vendue 500 au lieu de 550 : price_below_floor', !low.ok && low.error === 'price_below_floor', low)
  const gone = await sale([line(1, { key: 'bag', units: 50000, price: 30000 } as any)])
  check('mesure absente du produit : measure_invalid', !gone.ok && gone.error === 'measure_invalid', gone)
  const changed = await sale([{ ...line(1), measure_units: 600, quantity: 600 }])
  check('contenu changé depuis (600 au lieu de 700) : measure_invalid', !changed.ok && changed.error === 'measure_invalid', changed)
  const bad = await sale([{ ...line(3), quantity: 2000 }])
  check('quantité ≠ nombre × contenu : invalid_data', !bad.ok && bad.error === 'invalid_data', bad)
  const plain = await sale([{ product_id: 'p1', quantity: 100, unit_price: 1, subtotal: 100 }])
  check('vente au gramme au prix de base : acceptée (plancher inchangé)', plain.ok, plain)
  check('modification de vente : même contrôle par ligne', (await validateLinePrices(admin, 'shop', [line(2)])).ok && !(await validateLinePrices(admin, 'shop', [{ ...line(2), unit_price: 0.5 }])).ok)

  console.log('\n5. Vente en attente reprise')
  const product = { id: 'p1', name: 'Riz', quantity: 3000, selling_price: 1, unit: 'g', sale_measures: riz } as any
  const held = [
    { product, ...measureLineFields(box, 2), measure: { key: 'box', label: null, units: 700, price: 550, qty: 2 } },
    { product, ...measureLineFields(riz[2] as any, 1), measure: { key: 'bucket', label: null, units: 8000, price: 6500, qty: 1 } },
  ] as any[]
  const back = revalidateHeldCart(held, [{ ...product, quantity: 9400 }], () => 1, [])
  check('2 boîtes + 1 seau gardés tels quels (stock 9,4 kg, tout juste)', back.cart.length === 2 && back.cart[0].measure?.qty === 2 && back.cart[1].measure?.qty === 1 && !back.changes.length, back)
  const tight = revalidateHeldCart(held, [{ ...product, quantity: 8500 }], () => 1, [])
  check('stock 8,5 kg : 2 boîtes (1,4 kg) puis le seau (8 kg) retiré, signalé', tight.cart.length === 1 && tight.changes.some(c => c.kind === 'removed'), tight)
  const repriced = revalidateHeldCart(held.slice(0, 1), [{ ...product, quantity: 9000, sale_measures: [{ key: 'box', units: 700, price: 600 }] }], () => 1, [])
  check('prix de la boîte passé à 600 : nouveau prix, signalé', repriced.cart[0].subtotal === 1200 && repriced.changes.some(c => c.kind === 'price'), repriced)
  const removed = revalidateHeldCart(held.slice(0, 1), [{ ...product, quantity: 9000, sale_measures: null }], () => 1, [])
  check('mesure retirée du produit : ligne retirée, signalée', removed.cart.length === 0 && removed.changes[0]?.kind === 'removed')
  const plainHeld = revalidateHeldCart([{ product: { ...product, sale_measures: null, unit: 'piece', quantity: 5 }, quantity: 3, unit_price: 1, subtotal: 3 } as any], [{ ...product, sale_measures: null, unit: 'piece', quantity: 5 }], () => 1, [])
  check('ligne sans mesure : inchangée', plainHeld.cart[0].quantity === 3 && !plainHeld.changes.length)

  console.log(`\n${ok} réussis, ${ko} échec(s)`)
  process.exit(ko ? 1 : 0)
})()
