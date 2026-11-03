// Fonctions réservées par formule (tarification du 3 nov. 2026) : règle unique lib/saas/plan-features.
// Usage : npx tsx tests/e2e/plan-features-pure.ts
import { readFileSync } from 'fs'
import { featuresFor, legacyActive, reportStartAllowed, requireFeature, getShopFeatures, REPORT_FREE_DAYS, historyDays, historyFloor, clampStart, historyFeature, historyDaysFor, historyStartAllowed } from '../../lib/saas/plan-features'
import type { LegacyTerms } from '../../lib/saas/legacy-terms'

let ok = 0, ko = 0
const check = (label: string, cond: boolean, detail?: unknown) => { if (cond) { ok++; console.log('  ✓', label) } else { ko++; console.log('  ✗', label, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300)) } }
const NOW = new Date('2026-11-03T12:00:00Z')
const DAY = 86_400_000
const terms = (plan: LegacyTerms['plan'], until: string): LegacyTerms => ({ plan, shops: 3, team_members: 10, limits_until: until, currency: 'XOF', monthly_price: null })
const all = (m: Record<string, boolean>) => Object.values(m).every(Boolean)

;(async () => {
  console.log('1. Par formule')
  let f = featuresFor({ plan: 'starter' }, null, NOW)
  check('Starter (nouveau client) : ni transferts, ni e-mail des bons, ni exports, ni rapports longs, ni support prioritaire',
    !f.transfers && !f.po_email && !f.exports && !f.long_reports && !f.priority_support, f)
  f = featuresFor({ plan: 'pro' }, null, NOW)
  check('Pro : tout sauf le support prioritaire', f.transfers && f.po_email && f.exports && f.long_reports && !f.priority_support, f)
  f = featuresFor({ plan: 'business' }, null, NOW)
  check('Business : tout', all(f), f)
  f = featuresFor({ plan: 'trial' }, null, NOW)
  check('Essai : les fonctions de Pro', f.transfers && f.exports && f.long_reports && !f.priority_support, f)
  f = featuresFor({ plan: 'free' }, null, NOW)
  check('formule inconnue (ancienne valeur) : traitée comme l’essai', f.transfers && !f.priority_support, f)
  f = featuresFor(null, null, NOW)
  check('entreprise introuvable : traitée comme l’essai', f.exports && !f.priority_support, f)
  f = featuresFor({ plan: 'starter', is_internal: true }, null, NOW)
  check('compte interne : tout', all(f), f)

  console.log('\n2. Clients actuels : retrait seulement au prochain renouvellement')
  f = featuresFor({ plan: 'starter' }, terms('starter', '2027-03-01T00:00:00Z'), NOW)
  check('Starter actuel, anciennes conditions valables : tout reste comme avant (exports compris)', all(f), f)
  f = featuresFor({ plan: 'starter' }, terms('starter', '2026-11-01T00:00:00Z'), NOW)
  check('Starter actuel, anciennes conditions terminées : règles de Starter', !f.exports && !f.transfers, f)
  f = featuresFor({ plan: 'starter' }, terms('pro', '2027-03-01T00:00:00Z'), NOW)
  check('a changé de formule (ancien Pro devenu Starter) : règles de Starter', !f.exports, f)
  check('legacyActive : jour exact de fin = terminé', !legacyActive(terms('starter', NOW.toISOString()), 'starter', NOW))

  console.log('\n3. Rapports : 3 derniers mois sans Pro')
  check(`${REPORT_FREE_DAYS} jours couvrent « Ce trimestre » (92 jours au plus)`, REPORT_FREE_DAYS >= 92)
  check('début il y a 92 jours : permis', reportStartAllowed(new Date(NOW.getTime() - 92 * DAY), false, NOW))
  check('début il y a 93 jours (fuseau) : permis', reportStartAllowed(new Date(NOW.getTime() - 93 * DAY + 1000), false, NOW))
  check('début il y a 95 jours : refusé', !reportStartAllowed(new Date(NOW.getTime() - 95 * DAY), false, NOW))
  check('« Cette année » le 3 nov. : refusé', !reportStartAllowed('2026-01-01T00:00:00Z', false, NOW))
  check('« Cette année » le 15 févr. : permis (moins de 3 mois)', reportStartAllowed('2026-01-01T00:00:00Z', false, new Date('2026-02-15T12:00:00Z')))
  check('date illisible : refusée', !reportStartAllowed('pas une date', false, NOW))
  check('avec Pro : toute date', reportStartAllowed('2020-01-01T00:00:00Z', true, NOW))

  console.log('\n4. Refus du serveur (boutique → entreprise → formule)')
  const db: Record<string, any> = {
    shops: { s1: { id: 's1', entity_id: 'e1', country: 'NE' }, s2: { id: 's2', entity_id: 'e2', country: 'NE' } },
    entities: { e1: { id: 'e1', plan: 'starter', owner_user_id: 'u', legacy_terms: null }, e2: { id: 'e2', plan: 'pro', owner_user_id: 'u', legacy_terms: null } },
  }
  const admin = { from: (tb: string) => { let id = ''; const q: any = { select: () => q, eq: (_c: string, v: string) => { id = v; return q }, maybeSingle: async () => ({ data: db[tb][id] ?? null }) }; return q } }
  const t = (k: string, p?: any) => `${k}:${p?.plan}`
  const r = await requireFeature(admin, ['s1'], 'transfers', t)
  check('boutique Starter : 403 avec code stable, fonction et formule requise',
    r?.status === 403 && r.body.code === 'plan_feature_required' && r.body.feature === 'transfers' && r.body.required_plan === 'pro' && r.body.error === 'plan_feature_required:Pro', r)
  check('boutique Pro : permis', (await requireFeature(admin, ['s2'], 'exports', t)) === null)
  check('plusieurs boutiques dont une Starter : refusé', (await requireFeature(admin, ['s2', 's1'], 'po_email', t)) !== null)
  const sup = await requireFeature(admin, ['s2'], 'priority_support', t)
  check('support prioritaire sur Pro : refusé, formule Business annoncée', sup?.body.required_plan === 'business' && sup?.body.error.endsWith('Business'), sup)
  db.entities.e1.legacy_terms = terms('starter', '2027-03-01T00:00:00Z')
  check('Starter actuel (conditions en cours) : permis', (await getShopFeatures(admin, 's1', NOW)).features.exports)

  console.log('\n5. Les routes appliquent la règle')
  const src = (p: string) => readFileSync(p, 'utf8')
  check('création de transfert', /requireFeature\(admin, \[source_shop_id\], 'transfers'/.test(src('app/api/stock-transfers/route.ts')))
  check('envoi d’un brouillon de transfert', /requireFeature\(admin, \[tr\.source_shop_id\], 'transfers'/.test(src('app/api/stock-transfers/send/route.ts')))
  check('demande de transfert', /requireFeature\(admin, \[shopId\], 'transfers'/.test(src('app/api/stock-transfers/requests/route.ts')))
  check('e-mail des bons de commande', /requireFeature\(admin, \[shop_id\], 'po_email'/.test(src('app/api/purchase-orders/email/route.ts')))
  check('rapports', src('app/api/reports/summary/route.ts').includes('historyStartAllowed(start, days)'))
  const recv = src('app/api/stock-transfers/receive/route.ts') + src('app/api/stock-transfers/cancel/route.ts')
  check('réception et annulation d’un transfert : jamais bloquées', !/requireFeature/.test(recv))
  check('exports : bloqués dans le module commun', /lock === 'locked' \|\| lock === 'hidden'\) \{ openPlanLock\('exports'\)/.test(src('lib/export/use-table-export.ts')))

  console.log('\n6. Historique par formule (3 mois / 1 an / sans limite)')
  const hd = (plan: string, extra: any = {}, t2: any = null) => historyDays(featuresFor({ plan, ...extra }, t2, NOW))
  check('Starter 92 j, Pro 366 j, essai 366 j, Business sans limite', hd('starter') === 92 && hd('pro') === 366 && hd('trial') === 366 && hd('business') === -1, [hd('starter'), hd('pro'), hd('trial'), hd('business')])
  check('compte interne et Starter actuel (conditions en cours) : sans limite', hd('starter', { is_internal: true }) === -1 && hd('starter', {}, terms('starter', '2027-03-01T00:00:00Z')) === -1)
  check('fonction proposée : Pro depuis Starter, Business depuis Pro', historyFeature(92) === 'long_reports' && historyFeature(366) === 'unlimited_history')
  check('Pro : « Cette année » (1er janv.) le 31 déc. permis', historyStartAllowed('2026-01-01T00:00:00+01:00', 366, new Date('2026-12-31T22:00:00Z')))
  check('Pro : 12 mois du tableau de bord (1er déc. 2025) le 3 nov. 2026 permis', historyStartAllowed('2025-12-01T00:00:00Z', 366, NOW))
  check('Pro : 14 mois en arrière refusé', !historyStartAllowed('2025-09-01T00:00:00Z', 366, NOW))
  const fl = historyFloor(92, NOW)!
  check('limite Starter = maintenant - 93 jours', fl.toISOString() === new Date(NOW.getTime() - 93 * DAY).toISOString())
  check('sans limite : pas de date limite', historyFloor(-1, NOW) === null)
  const local = '2026-10-01T00:00:00+01:00'
  check('date permise rendue TELLE QUELLE (fuseau gardé, les dépenses se lisent sur 10 caractères)', clampStart(local, 92, NOW) === local)
  check('date trop ancienne : ramenée à la limite', clampStart('2026-01-01T00:00:00Z', 92, NOW) === fl.toISOString())
  check('pas de date (« depuis toujours ») : la limite', clampStart(null, 92, NOW) === fl.toISOString() && clampStart(null, -1, NOW) === null)
  const db2: Record<string, any> = {
    shops: [{ id: 'a', entity_id: 'e1' }, { id: 'b', entity_id: 'e2' }, { id: 'c', entity_id: null }],
    entities: [{ id: 'e1', plan: 'starter', is_internal: false, legacy_terms: null }, { id: 'e2', plan: 'business', is_internal: false, legacy_terms: null }],
  }
  let reads = 0
  const admin2 = { from: (tb: string) => { reads++; let ids: string[] = []; const q: any = { select: () => q, in: (_c: string, v: string[]) => { ids = v; return q }, then: (r: any) => r({ data: db2[tb].filter((x: any) => ids.includes(x.id)), error: null }) }; return q } }
  check('plusieurs boutiques : la plus limitée l’emporte (Starter + Business = 3 mois)', (await historyDaysFor(admin2, ['a', 'b'], NOW)) === 92)
  check('Business seule : sans limite', (await historyDaysFor(admin2, ['b'], NOW)) === -1)
  check('boutique sans entreprise : comme l’essai (1 an)', (await historyDaysFor(admin2, ['c', 'b'], NOW)) === 366)
  reads = 0; await historyDaysFor(admin2, ['a', 'b', 'c'], NOW)
  check('deux lectures quel que soit le nombre de boutiques', reads === 2, reads)
  const errAdmin = { from: () => { const q: any = { select: () => q, in: () => q, then: (r: any) => r({ data: null, error: { message: 'x' } }) }; return q } }
  check('lecture impossible : pas de limite (affichage, la base garde sa règle)', (await historyDaysFor(errAdmin, ['a'], NOW)) === -1)

  console.log('\n7. Routes : durée appliquée, exceptions jamais limitées')
  const D = 'app/api/dashboard/'
  for (const f of ['summary', 'live', 'payments-today', 'expense-revenue', 'revenue-yearly', 'top-products'])
    check(`tableau de bord › ${f}`, src(D + f + '/route.ts').includes('historyDaysFor(admin, shopIds)') && src(D + f + '/route.ts').includes('clampStart('))
  check('rapports : durée de la boutique la plus limitée', src('app/api/reports/summary/route.ts').includes('historyDaysFor(admin, reportShops)') && src('app/api/reports/summary/route.ts').includes('historyRefusal(days, t)'))
  check('mouvements de stock : sans date = la limite', src('app/api/stock/movements/route.ts').includes('const since = floor && (!fromIso'))
  check('journal des ventes', src('app/api/sales/logs/route.ts').includes('clampStart(from, await historyDaysFor(admin, effectiveShopIds))'))
  check('historique global des crédits : les crédits encore dus restent', src('app/api/payments/history-all/route.ts').includes('created_at.gte.${floor.toISOString()},balance.gt.0'))
  const never = ['app/api/payments/debts/route.ts', 'app/api/payments/history/route.ts', 'app/r/[token]/page.tsx'].map(src).join('\n')
  check('jamais limités : crédits dus, historique d’un client, reçu public', !/historyDaysFor|clampStart|historyFloor/.test(never))

  console.log(`\n${ok} réussis, ${ko} échec(s)`)
  process.exit(ko ? 1 : 0)
})().catch(e => { console.error('ERREUR', e); process.exit(1) })
