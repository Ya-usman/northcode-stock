// Fonctions réservées par formule (tarification du 3 nov. 2026) : règle unique lib/saas/plan-features.
// Usage : npx tsx tests/e2e/plan-features-pure.ts
import { readFileSync } from 'fs'
import { featuresFor, legacyActive, reportStartAllowed, requireFeature, getShopFeatures, REPORT_FREE_DAYS } from '../../lib/saas/plan-features'
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
  check('rapports', /reportStartAllowed\(start, features\.long_reports\)/.test(src('app/api/reports/summary/route.ts')))
  const recv = src('app/api/stock-transfers/receive/route.ts') + src('app/api/stock-transfers/cancel/route.ts')
  check('réception et annulation d’un transfert : jamais bloquées', !/requireFeature/.test(recv))
  check('exports : bloqués dans le module commun', /lock === 'locked' \|\| lock === 'hidden'\) \{ openPlanLock\('exports'\)/.test(src('lib/export/use-table-export.ts')))

  console.log(`\n${ok} réussis, ${ko} échec(s)`)
  process.exit(ko ? 1 : 0)
})().catch(e => { console.error('ERREUR', e); process.exit(1) })
