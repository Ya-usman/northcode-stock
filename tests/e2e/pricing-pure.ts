// Tarification du 3 nov. 2026 : prix par pays, durées, options, formules, clients actuels (prix garanti, limites).
// Usage : npx tsx tests/e2e/pricing-pure.ts
import { COUNTRIES, getPeriodPrice, getPeriodDays, getBillingCurrency, OFFERED_PERIODS, BILLING_PERIODS } from '../../lib/saas/countries'
import { PLANS } from '../../lib/saas/plans'
import { monthlyPriceFor, planLimitWithLegacy, parseLegacyTerms, renewsWithoutBreak } from '../../lib/saas/legacy-terms'

let ok = 0, ko = 0
const check = (label: string, cond: boolean, detail?: unknown) => { if (cond) { ok++; console.log('  ✓', label) } else { ko++; console.log('  ✗', label, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300)) } }

console.log('1. Formules')
check('Starter 1 boutique + 2 employés', PLANS.starter.limits.shops === 1 && PLANS.starter.limits.team_members === 2)
check('Pro 2 boutiques + 5 employés', PLANS.pro.limits.shops === 2 && PLANS.pro.limits.team_members === 5)
check('Business 3 boutiques + 8 employés', PLANS.business.limits.shops === 3 && PLANS.business.limits.team_members === 8)
check('essai : limites de Pro', PLANS.trial.limits.shops === 2 && PLANS.trial.limits.team_members === 5)

console.log('\n2. Durées')
check('proposées : mensuel, 6 mois, 1 an (plus de trimestre)', OFFERED_PERIODS.join() === 'monthly,semiannual,annual')
check('Pro FCFA : 10 000 / 55 000 (6 mois) / 100 000 (1 an)', getPeriodPrice(10000, 'monthly') === 10000 && getPeriodPrice(10000, 'semiannual') === 55000 && getPeriodPrice(10000, 'annual') === 100000)
check('Starter Europe : 15 / 82,50 / 150 €', getPeriodPrice(15, 'semiannual') === 82.5 && getPeriodPrice(15, 'annual') === 150)
check('employé à 1,5 $ sur 6 mois : 8,25 $', getPeriodPrice(1.5, 'semiannual') === 8.25)
check('jours : 31 / 183 / 365', getPeriodDays('monthly') === 31 && getPeriodDays('semiannual') === 183 && getPeriodDays('annual') === 365)
check('ancien trimestre gardé pour les abonnements en cours (92 jours, non proposé)', getPeriodDays('quarterly') === 92 && BILLING_PERIODS.quarterly.legacy === true)

console.log('\n3. Tableau validé, pays par pays')
const expect: Record<string, [number, number, number, number, number, string]> = {
  NG: [5000, 10000, 15000, 1500, 4000, 'NGN'], CM: [5000, 10000, 15000, 1500, 4000, 'XAF'], NE: [5000, 10000, 15000, 1500, 4000, 'XOF'],
  CI: [5000, 10000, 15000, 1500, 4000, 'XOF'], GH: [100, 200, 300, 30, 80, 'GHS'], GN: [50000, 100000, 150000, 15000, 40000, 'GNF'],
  GM: [500, 1000, 1500, 150, 400, 'GMD'], SL: [150, 300, 450, 45, 120, 'SLE'], LR: [5, 10, 15, 1.5, 4, 'USD'], CV: [1000, 2000, 3000, 300, 800, 'CVE'],
  MR: [300, 600, 900, 90, 240, 'MRU'], CD: [5, 10, 15, 1.5, 4, 'USD'], US: [15, 25, 50, 5, 12, 'USD'], CA: [20, 35, 70, 7, 17, 'CAD'],
  FR: [15, 25, 50, 5, 12, 'EUR'], PL: [15, 25, 50, 5, 12, 'EUR'],
}
for (const [code, [st, pr, bu, seat, shop, cur]] of Object.entries(expect)) {
  const c = (COUNTRIES as any)[code]
  check(`${code} : ${st} / ${pr} / ${bu} ${cur}, employé ${seat}, boutique ${shop}`,
    c.prices.starter === st && c.prices.pro === pr && c.prices.business === bu && c.addons.seat === seat && c.addons.shop === shop && getBillingCurrency(c) === cur, { p: c.prices, a: c.addons, cur: getBillingCurrency(c) })
}
// Règle des options, pour TOUS les pays : jamais moins cher de prendre des options que la formule du dessus
const bad: string[] = []
for (const c of Object.values(COUNTRIES)) {
  const { starter, pro, business } = c.prices, { seat, shop } = c.addons
  if (!(starter + 4 * seat > pro)) bad.push(`${c.code} Starter + 4 employés`)
  if (!(pro + shop + 3 * seat > business)) bad.push(`${c.code} Pro + 1 boutique + 3 employés`)
  if (!(starter > 0 && pro > starter && business > pro)) bad.push(`${c.code} ordre des prix`)
}
check(`tous les pays (${Object.keys(COUNTRIES).length}) : options jamais plus avantageuses que la formule du dessus`, !bad.length, bad)

console.log('\n4. Clients actuels : prix garanti')
const future = new Date(Date.now() + 60 * 86400000).toISOString()
const sofar = parseLegacyTerms({ plan: 'pro', shops: 2, team_members: 5, limits_until: '2027-04-01T00:00:00Z', currency: 'XOF', monthly_price: 7999 })
const alpha = parseLegacyTerms({ plan: 'business', shops: 10, team_members: 30, limits_until: '2027-04-10T00:00:00Z', currency: 'NGN', monthly_price: 19999 })
check('SOFAR (Pro, XOF) : 7 999 garanti au lieu de 10 000', JSON.stringify(monthlyPriceFor(10000, 'pro', 'XOF', sofar, { plan: 'pro', plan_expires_at: future })) === '{"price":7999,"locked":true}')
check('Alpha (Business, NGN) : nouveau prix 15 000, moins cher que l’ancien 19 999', JSON.stringify(monthlyPriceFor(15000, 'business', 'NGN', alpha, { plan: 'business', plan_expires_at: future })) === '{"price":15000,"locked":false}')
check('SOFAR qui passe en Business : prix du tarif', monthlyPriceFor(15000, 'business', 'XOF', sofar, { plan: 'pro', plan_expires_at: future }).price === 15000)
check('autre devise : prix du tarif', monthlyPriceFor(10000, 'pro', 'XAF', sofar, { plan: 'pro', plan_expires_at: future }).price === 10000)
const sixDaysAgo = new Date(Date.now() - 6 * 86400000).toISOString(), tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString()
check('échue depuis 6 jours (délai de grâce de 7 jours) : toujours garanti', renewsWithoutBreak(sixDaysAgo) && monthlyPriceFor(10000, 'pro', 'XOF', sofar, { plan: 'pro', plan_expires_at: sixDaysAgo }).price === 7999)
check('échue depuis 10 jours : interruption, prix du tarif', !renewsWithoutBreak(tenDaysAgo) && monthlyPriceFor(10000, 'pro', 'XOF', sofar, { plan: 'pro', plan_expires_at: tenDaysAgo }).price === 10000)
check('aucune condition : prix du tarif', monthlyPriceFor(10000, 'pro', 'XOF', null, { plan: 'pro', plan_expires_at: future }).price === 10000)

console.log('\n5. Clients actuels : anciennes limites')
const before = new Date('2027-03-01T00:00:00Z'), after = new Date('2027-05-01T00:00:00Z')
check('Alpha (Business) avant la date : 10 boutiques, 30 employés', planLimitWithLegacy(3, 'business', alpha, 'shops', before) === 10 && planLimitWithLegacy(8, 'business', alpha, 'team_members', before) === 30)
check('Alpha après la date : 3 boutiques, 8 employés', planLimitWithLegacy(3, 'business', alpha, 'shops', after) === 3 && planLimitWithLegacy(8, 'business', alpha, 'team_members', after) === 8)
check('Alpha passé en Pro : limites du Pro', planLimitWithLegacy(2, 'pro', alpha, 'shops', before) === 2)
check('illimité reste illimité', planLimitWithLegacy(-1, 'business', alpha, 'shops', before) === -1)
check('donnée abîmée : ignorée', parseLegacyTerms({ plan: 'gold', shops: 1 }) === null && parseLegacyTerms(null) === null)

console.log(`\n${ok} réussis, ${ko} échec(s)`)
process.exit(ko ? 1 : 0)
