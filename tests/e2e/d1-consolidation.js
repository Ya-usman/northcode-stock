// Moteur de consolidation multi-devises (lot 5, D1) — tests PURS sur taux synthétiques, puis lecture seule
// des vrais taux et de la vraie devise de consolidation d'Alpha (NGN + XAF). Aucune écriture.
// Usage : node tests/e2e/d1-consolidation.js
const fs = require('fs')
const path = require('path')
const ROOT = path.resolve(__dirname, '../..')
const jiti = require(ROOT + '/node_modules/jiti')(__filename, { alias: { '@': ROOT } })
const C = jiti(ROOT + '/lib/reporting/consolidation.ts')

let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}`) }
const near = (a, b, eps = 1e-6) => a !== null && b !== null && Math.abs(a - b) <= eps * Math.max(1, Math.abs(b))
const row = (currency, effective_date, rate, provider = 'frankfurter', is_manual_override = false) => ({ currency, effective_date, rate, provider, is_manual_override })

// Taux synthétiques (1 devise = rate USD). Lundi 05/10/2026 et mardi 06/10/2026 : NGN différent ; EUR stable.
const rows = [
  row('EUR', '2026-10-05', 1.10), row('EUR', '2026-10-06', 1.10),
  row('NGN', '2026-10-05', 0.0007), row('NGN', '2026-10-06', 0.0008),
  row('USD', '2026-10-05', 1),
]
const index = C.buildRateIndex(rows)
const scope = (target, cur, idx = index) => ({ target, scopeCurrencies: cur, index: idx })

console.log('\n1. Entreprise 100 % XAF : aucune conversion')
{
  const r = C.consolidateFlows(scope('XAF', ['XAF']), [{ currency: 'XAF', date: '2026-10-05', amount: 1000 }, { currency: 'XAF', date: '2026-10-06', amount: 500 }])
  ok(r.consolidated === null && r.byCurrency.XAF === 1500 && Object.keys(r.byCurrency).length === 1, 'XAF seul → 1 500 XAF, pas de « ≈ »')
  ok(C.rankingValue(scope('XAF', ['XAF']), [{ currency: 'XAF', date: '2026-10-05', amount: 7 }]) === 7, 'classement : valeur d’origine, sans taux')
  ok(C.consolidateFlows(scope('NGN', ['XAF']), [{ currency: 'XAF', date: '2026-10-05', amount: 10 }]).consolidated === null, 'une seule devise mais cible différente : toujours aucune conversion')
}

console.log('\n2. Parités fixes exactes (sans aucun taux du marché)')
{
  const empty = C.buildRateIndex([])
  ok(C.convertAt(1, 'EUR', 'XAF', '2026-10-05', empty).value === 655.957, '1 EUR = 655,957 XAF exactement')
  ok(C.convertAt(1, 'EUR', 'XOF', '2026-10-05', empty).value === 655.957, '1 EUR = 655,957 XOF exactement')
  ok(C.convertAt(655957, 'XAF', 'EUR', '2026-10-05', empty).value === 1000, '655 957 XAF = 1 000 EUR exactement')
  ok(C.convertAt(12345, 'XAF', 'XOF', '2026-10-05', empty).value === 12345, 'XAF ↔ XOF = 1:1 exactement')
  ok(C.convertAt(1, 'EUR', 'XAF', '2026-10-05', empty).sources.join() === 'fixed_parity', 'source déclarée : parité fixe')
  // Taux du marché arrondis présents en base pour XAF : jamais utilisés
  const polluted = C.buildRateIndex([...rows, row('XAF', '2026-10-05', 0.0017118598)])
  ok(C.convertAt(1, 'EUR', 'XAF', '2026-10-05', polluted).value === 655.957, 'une ligne de marché XAF en base ne change rien')
  // XAF → NGN : exact vers l'euro, puis EUR → NGN du jour
  const v = C.convertAt(655957, 'XAF', 'NGN', '2026-10-05', index).value
  ok(near(v, 1000 * 1.10 / 0.0007), `XAF → NGN par l’euro : ${v.toFixed(2)} NGN`)
}

console.log('\n3. XAF + NGN, ventes à deux dates aux taux différents')
{
  const s = scope('NGN', ['NGN', 'XAF'])
  const r = C.consolidateFlows(s, [
    { currency: 'NGN', date: '2026-10-05', amount: 10000 },
    { currency: 'XAF', date: '2026-10-05', amount: 655957 },
    { currency: 'XAF', date: '2026-10-06', amount: 655957 },
  ])
  const attendu = 10000 + 1000 * 1.10 / 0.0007 + 1000 * 1.10 / 0.0008
  ok(r.byCurrency.NGN === 10000 && r.byCurrency.XAF === 1311914, 'ventilation par devise d’origine complète')
  ok(r.consolidated && near(r.consolidated.value, attendu, 1e-9) && r.consolidated.method === 'historical', `≈ ${r.consolidated?.value} NGN (taux de chaque date)`)
  ok(r.consolidated && !r.consolidated.partial && r.consolidated.sources.includes('fixed_parity') && r.consolidated.sources.includes('frankfurter'), 'sources : parité fixe + Frankfurter')
}

console.log('\n4. Rapport historique stable quand le taux du jour change')
{
  const lines = [{ currency: 'NGN', date: '2026-10-05', amount: 1000000 }]
  const avant = C.consolidateFlows(scope('EUR', ['EUR', 'NGN']), lines).consolidated.value
  const idx2 = C.buildRateIndex([...rows, row('NGN', '2026-10-20', 0.0005), row('EUR', '2026-10-20', 1.3)])
  const apres = C.consolidateFlows(scope('EUR', ['EUR', 'NGN'], idx2), lines).consolidated.value
  ok(avant === apres, `vente du 05/10 : ${avant} EUR avant et après l’arrivée de nouveaux taux`)
}

console.log('\n5. Soldes : taux de clôture de la date de situation')
{
  const idx = C.buildRateIndex([...rows, row('NGN', '2026-10-20', 0.0005), row('EUR', '2026-10-20', 1.10)])
  const s = scope('EUR', ['EUR', 'NGN'], idx)
  const courant = C.consolidateBalances(s, [{ currency: 'NGN', amount: 1100000 }], '2026-10-21')
  ok(near(courant.consolidated.value, 1100000 * 0.0005 / 1.10) && courant.consolidated.method === 'closing' && courant.consolidated.valuationDate === '2026-10-21',
    `solde au 21/10 : taux du 20/10 (dernier ≤ date) → ${courant.consolidated.value} EUR`)
  const passe = C.consolidateBalances(s, [{ currency: 'NGN', amount: 1100000 }], '2026-10-06')
  ok(near(passe.consolidated.value, 1100000 * 0.0008 / 1.10), `situation au 06/10 : taux du 06/10, jamais celui d’aujourd’hui → ${passe.consolidated.value} EUR`)
}

console.log('\n6. Taux manquant : ventilation complète + total partiel, rien d’inventé')
{
  const s = scope('XAF', ['NGN', 'XAF'])
  const r = C.consolidateFlows(s, [
    { currency: 'XAF', date: '2026-03-14', amount: 5000 },
    { currency: 'NGN', date: '2026-03-14', amount: 9000 },
    { currency: 'NGN', date: '2026-10-05', amount: 1000 },
  ])
  ok(r.byCurrency.NGN === 10000 && r.byCurrency.XAF === 5000, 'ventilation complète (NGN 10 000, XAF 5 000)')
  ok(r.consolidated.partial && r.consolidated.missing.length === 1 && r.consolidated.missing[0].currency === 'NGN' && r.consolidated.missing[0].date === '2026-03-14',
    'manquant signalé : NGN le 14/03/2026')
  ok(near(r.consolidated.value, 5000 + 1000 * 0.0007 / 1.10 * 655.957), `total partiel ≈ ${r.consolidated.value} XAF (NGN du 14/03 exclu)`)
  ok(C.rankingValue(s, [{ currency: 'NGN', date: '2026-03-14', amount: 1 }]) === null, 'classement : null (classé après, signalé), jamais 0')
}

console.log('\n7. EUR + USD')
{
  const r = C.consolidateFlows(scope('USD', ['EUR', 'USD']), [{ currency: 'EUR', date: '2026-10-06', amount: 100 }, { currency: 'USD', date: '2026-10-06', amount: 50 }])
  ok(near(r.consolidated.value, 160), `100 EUR + 50 USD ≈ ${r.consolidated.value} USD`)
}

console.log('\n8. Priorité : taux manuel VALIDE > Frankfurter > er-api ; sources non validées ignorées')
{
  const idx = C.buildRateIndex([
    row('NGN', '2026-10-05', 0.0009, 'er-api'), row('NGN', '2026-10-05', 0.0007, 'frankfurter'),
    row('GHS', '2026-10-05', 0.08, 'frankfurter'), row('GHS', '2026-10-05', 0.09, 'manual', true),
    row('CDF', '2026-10-05', 0.0005, 'manual_seed'), row('CDF', '2026-10-05', 0.0004, 'frankfurter'),
    row('GNF', '2026-10-05', 0.0002, 'manual_seed'),
    row('GMD', '2026-10-05', 0.02, 'manual_seed', true), row('GMD', '2026-10-05', 0.0136, 'er-api'),
  ])
  ok(idx.usd('NGN', '2026-10-05').rate === 0.0007, 'Frankfurter passe avant er-api à la même date (quel que soit l’ordre)')
  ok(idx.usd('GHS', '2026-10-05').rate === 0.09 && idx.usd('GHS', '2026-10-05').source === 'manual', 'override super_admin (is_manual_override + provider manual) prioritaire')
  ok(idx.usd('CDF', '2026-10-05').rate === 0.0004, 'ancien manual_seed : ne gagne jamais contre Frankfurter')
  ok(idx.usd('GNF', '2026-10-05') === null, 'manual_seed seul : ignoré (taux indisponible, jamais utilisé)')
  ok(idx.usd('GMD', '2026-10-05').rate === 0.0136, 'override marqué mais fournisseur ≠ manual : ignoré, er-api utilisé')
}

console.log('\n8 ter. Repli : dernier taux AVANT la date, au plus 5 jours calendaires')
{
  const idx = C.buildRateIndex([row('NGN', '2026-10-09', 0.0007), row('NGN', '2026-10-20', 0.0009), row('EUR', '2026-10-01', 1.1), row('EUR', '2026-10-09', 1.1)])
  const exact = idx.usd('NGN', '2026-10-09')
  ok(exact.rate === 0.0007 && exact.effectiveDate === '2026-10-09', 'date exacte : taux du jour')
  ok(idx.usd('NGN', '2026-10-10').effectiveDate === '2026-10-09', 'repli 1 jour (samedi → vendredi)')
  ok(idx.usd('NGN', '2026-10-14').effectiveDate === '2026-10-09', 'repli 5 jours : accepté')
  ok(idx.usd('NGN', '2026-10-15') === null, 'repli 6 jours : indisponible (jamais le taux du 20/10, postérieur)')
  ok(idx.usd('NGN', '2026-10-08') === null, 'avant le premier taux : indisponible (jamais un taux futur)')
  const r = C.consolidateFlows(scope('EUR', ['EUR', 'NGN'], idx), [
    { currency: 'NGN', date: '2026-10-12', amount: 1000 }, { currency: 'NGN', date: '2026-10-09', amount: 1000 }, { currency: 'NGN', date: '2026-10-16', amount: 500 }])
  const fb = r.consolidated.fallbacks
  ok(fb.length === 2 && fb.some(u => u.currency === 'NGN' && u.requestedDate === '2026-10-12' && u.rateDate === '2026-10-09' && u.source === 'frankfurter'),
    'repli enregistré : NGN demandé le 12/10, taux du 09/10, Frankfurter (date exacte non listée)')
  ok(r.consolidated.partial && r.consolidated.missing.length === 1 && r.consolidated.missing[0].date === '2026-10-16', '16/10 (7 jours) : « Total partiel », NGN le 16/10 listé')
  ok(r.byCurrency.NGN === 2500, 'montant d’origine toujours complet (2 500 NGN)')
  const xaf = C.consolidateFlows(scope('EUR', ['EUR', 'XAF'], C.buildRateIndex([])), [{ currency: 'XAF', date: '2030-01-01', amount: 655957 }])
  ok(xaf.consolidated.value === 1000 && !xaf.consolidated.partial && xaf.consolidated.fallbacks.length === 0, 'XAF → EUR sans aucun taux en base : exact, jamais de repli ni de manquant')
}

console.log('\n8 bis. Devises de l’application = contrainte de la migration 177')
{
  const { SUPPORTED_CURRENCY_CODES } = jiti(ROOT + '/lib/saas/currencies.ts')
  const m177 = fs.readFileSync(ROOT + '/supabase/migrations/177_entities_consolidation_currency.sql', 'utf8')
  const inCheck = m177.match(/entities_consolidation_currency_supported CHECK \(consolidation_currency = ANY \(ARRAY\[([\s\S]*?)\]/)[1].match(/'([A-Z]{3})'/g).map(s => s.slice(1, 4))
  ok(inCheck.length === SUPPORTED_CURRENCY_CODES.length && inCheck.every(c => SUPPORTED_CURRENCY_CODES.includes(c)), `${inCheck.length} codes, identiques des deux côtés`)
}

console.log('\n9. Boutiques de plusieurs entreprises : aucun consolidé')
{
  const multi = { target: null, scopeCurrencies: ['NGN', 'XAF'], multipleEntities: true, index }
  const r = C.consolidateFlows(multi, [{ currency: 'NGN', date: '2026-10-05', amount: 1 }])
  ok(r.consolidated === null && r.reason === 'multiple_entities' && r.byCurrency.XAF === 0 && r.byCurrency.NGN === 1, 'ventilation seule, raison « multiple_entities »')
  // Même si une cible traînait (erreur d'appelant), plusieurs entreprises → jamais de consolidé
  ok(C.consolidateBalances({ ...multi, target: 'NGN' }, [{ currency: 'XAF', amount: 5 }], '2026-10-05').consolidated === null, 'une cible présente ne suffit jamais : aucun consolidé entre entreprises')
  ok(C.rankingValue(multi, [{ currency: 'NGN', date: '2026-10-05', amount: 1 }]) === null, 'classement : null → classé devise par devise, jamais XAF contre NGN')
  const same = { target: 'XAF', scopeCurrencies: ['XAF'], multipleEntities: true, index }
  const r2 = C.consolidateFlows(same, [{ currency: 'XAF', date: '2026-10-05', amount: 3 }])
  ok(r2.consolidated === null && r2.reason === 'single_currency' && r2.byCurrency.XAF === 3, 'deux entreprises en XAF seulement : une seule devise, simple total XAF')
  ok(C.consolidateFlows(scope('XAF', ['XAF']), []).reason === 'single_currency', 'une seule devise : raison « single_currency »')
}

;(async () => {
  console.log('\n10. Vrais taux (lecture seule) — Alpha : NGN + XAF')
  const env = {}
  for (const line of fs.readFileSync(ROOT + '/.env.local', 'utf8').split('\n')) { const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (m) env[m[1]] = m[2].trim() }
  const { createClient } = require(ROOT + '/node_modules/@supabase/supabase-js')
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const S = jiti(ROOT + '/lib/reporting/consolidation-server.ts')
  const { data: shops } = await admin.from('shops').select('id, currency').eq('entity_id', (await admin.from('shops').select('entity_id').eq('id', 'a0000000-0000-0000-0000-000000000001').single()).data.entity_id).is('deleted_at', null)
  const sc = await S.loadConsolidationScope(admin, shops.map(s => s.id), { from: '2026-05-01', to: '2026-10-23' })
  ok(sc.target === 'NGN' && sc.scopeCurrencies.join() === 'NGN,XAF', `cible ${sc.target}, devises ${sc.scopeCurrencies.join(' + ')}`)
  const r19 = C.convertAt(655957, 'XAF', 'NGN', '2026-10-19', sc.index)
  ok(r19 && near(r19.value, 1000 * 1.1233304501 / 0.0007511906), `655 957 XAF le 19/10 ≈ ${r19 && r19.value.toFixed(0)} NGN (taux insérés le 23/10)`)
  const sat = sc.index.usd('NGN', '2026-10-17')
  ok(sat && sat.effectiveDate === '2026-10-16', `samedi 17/10 → taux du vendredi ${sat && sat.effectiveDate}`)
  const old = C.consolidateFlows(sc, [{ currency: 'XAF', date: '2026-05-02', amount: 1000 }])
  ok(old.consolidated && !old.consolidated.partial, 'début mai : taux disponibles (aucun manquant)')
  const sc1 = await S.loadConsolidationScope(admin, [shops.find(s => s.currency === 'XAF').id], { from: '2026-05-01', to: '2026-10-23' })
  ok(C.needsConsolidation(sc1) === false, 'une seule boutique XAF d’Alpha : aucune conversion, aucun taux chargé')
  ok(sc.entityId && !sc.multipleEntities, 'Alpha : une seule entreprise')

  console.log('\n11. Vraies boutiques de deux entreprises (Alpha NGN + Marché Soleil Akwa XAF), lecture seule')
  const ngnShop = shops.find(s => s.currency === 'NGN').id
  const mix = await S.loadConsolidationScope(admin, [ngnShop, '7313d74e-43dd-4b36-a59e-17ba370d29a1'], { from: '2026-10-01', to: '2026-10-23' })
  ok(mix.multipleEntities && mix.target === null && mix.entityId === null, 'deux entreprises détectées par le serveur : aucune devise imposée')
  ok(C.consolidateFlows(mix, [{ currency: 'NGN', date: '2026-10-05', amount: 1 }]).reason === 'multiple_entities', 'aucun consolidé, raison « multiple_entities »')
  ok(mix.index.usd('NGN', '2026-10-09') === null, 'aucun taux chargé pour un périmètre multi-entreprises')

  console.log(`\n${pass} réussis, ${fail} échec(s)`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error('ERREUR', e.message); process.exit(1) })
