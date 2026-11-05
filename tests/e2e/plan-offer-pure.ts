// Pages de tarifs (tarification étape 4B) : offre PRÉSENTÉE = règles réelles. Lignes des formules et tableau de
// comparaison (lib/saas/plan-offer) comparés aux limites (lib/saas/plans) et aux fonctions réservées
// (lib/saas/plan-features, règle du serveur) ; pays de départ de la page d'accueil ; textes dans les trois langues.
// Usage : npx tsx tests/e2e/plan-offer-pure.ts
import { readFileSync } from 'fs'
import { OFFER_PLANS, PLAN_LINE_KEYS, POPULAR_PLAN, COMPARE_ROWS, compareCell, featureIncluded, defaultPricingCountry } from '../../lib/saas/plan-offer'
import { featuresFor, PLAN_FEATURES, historyDays } from '../../lib/saas/plan-features'
import { PLANS } from '../../lib/saas/plans'
import { COUNTRIES, getPeriodPrice, BILLING_PERIODS } from '../../lib/saas/countries'

let pass = 0, fail = 0
const ok = (c: boolean, msg: string, x?: unknown) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${msg}${!c && x !== undefined ? ' → ' + JSON.stringify(x).slice(0, 300) : ''}`) }
const read = (p: string) => readFileSync(__dirname + '/../../' + p, 'utf8')
const msgs = Object.fromEntries(['fr', 'en', 'ha'].map(l => [l, JSON.parse(read(`messages/${l}.json`))]))

console.log('1. Fonctions par formule = règle du serveur')
for (const plan of OFFER_PLANS) {
  const server = featuresFor({ plan }, null)
  const diff = PLAN_FEATURES.filter(f => featureIncluded(plan, f) !== server[f])
  ok(diff.length === 0, `${plan} : mêmes fonctions que le serveur`, diff)
}
ok(POPULAR_PLAN === 'pro', 'Pro mis en avant')

console.log('\n2. Tableau de comparaison')
const cell = (row: any, plan: any) => compareCell(row, plan)
ok(OFFER_PLANS.map(p => (cell('shops', p) as any).value).join('/') === '1/2/3', 'boutiques 1 / 2 / 3 (décision du 3 nov.)')
ok(OFFER_PLANS.map(p => (cell('seats', p) as any).value).join('/') === '2/5/8', 'employés 2 / 5 / 8, propriétaire non compté')
ok(OFFER_PLANS.every(p => (cell('shops', p) as any).value === PLANS[p].limits.shops && (cell('seats', p) as any).value === PLANS[p].limits.team_members), 'chiffres lus dans les limites réelles')
ok(OFFER_PLANS.map(p => (cell('history', p) as any).key).join('/') === 'history_3m/history_1y/history_all', 'historique 3 mois / 1 an / illimité')
ok(OFFER_PLANS.every(p => {
  const d = historyDays(featuresFor({ plan: p }, null)); const k = (cell('history', p) as any).key
  return (k === 'history_3m' && d === 92) || (k === 'history_1y' && d === 366) || (k === 'history_all' && d === -1)
}), 'historique affiché = durée appliquée par le serveur')
ok(['transfers', 'po_email', 'exports'].every(r => !(cell(r, 'starter') as any).value && (cell(r, 'pro') as any).value && (cell(r, 'business') as any).value), 'transferts, bons, exports : Pro et Business')
ok(!(cell('support', 'pro') as any).value && (cell('support', 'business') as any).value, 'support prioritaire : Business seulement')
ok(OFFER_PLANS.every(p => (cell('addons', p) as any).key === 'addon_optional'), 'options : toutes les formules')
ok(COMPARE_ROWS.length === 8, '8 lignes')

console.log('\n3. Pays de départ de la page d\'accueil (affichage seulement)')
const known = (c: string) => c in COUNTRIES
ok(defaultPricingCountry('fr', null, known) === 'CM', 'français sans pays connu : Cameroun')
ok(defaultPricingCountry('en', null, known) === 'NG' && defaultPricingCountry('ha', undefined, known) === 'NG', 'anglais / haoussa : Nigeria')
ok(defaultPricingCountry('fr', 'fr', known) === 'FR' && defaultPricingCountry('en', 'SN', known) === 'SN', 'pays de l\'hébergeur prioritaire')
ok(defaultPricingCountry('fr', 'ZZ', known) === 'CM' && defaultPricingCountry('en', 'XYZ', known) === 'NG', 'pays inconnu ou invalide : langue')

console.log('\n4. Prix par durée (même calcul que le paiement)')
ok(getPeriodPrice(COUNTRIES.CM.prices.pro, 'semiannual') === 55000 && getPeriodPrice(COUNTRIES.CM.prices.pro, 'annual') === 100000, 'Pro Cameroun : 55 000 (6 mois), 100 000 (1 an)')
ok(Math.round(getPeriodPrice(25, 'semiannual') / BILLING_PERIODS.semiannual.months) === 23, 'Pro Europe 6 mois : 23 € par mois')
ok(COUNTRIES.CM.addons.seat === 1500 && COUNTRIES.CM.addons.shop === 4000, 'options Cameroun : 1 500 / 4 000')

console.log('\n5. Textes communs (fr / en / ha)')
const need = [...OFFER_PLANS.flatMap(p => PLAN_LINE_KEYS[p]), 'period_monthly', 'period_semiannual', 'period_annual', 'badge_semiannual', 'badge_annual',
  'per_month_equiv', 'per_month', 'per_6months', 'per_3months', 'per_year', 'period_label', 'compare_toggle', 'compare_hide', 'compare_caption',
  ...COMPARE_ROWS.map(r => `row_${r}`), 'history_3m', 'history_1y', 'history_all', 'included', 'not_included', 'addon_optional', 'addons_line', 'pay_soon']
for (const l of ['fr', 'en', 'ha']) {
  const po = msgs[l].plan_offer || {}
  const missing = need.filter(k => typeof po[k] !== 'string' || !po[k].trim())
  ok(missing.length === 0, `${l} : ${need.length} textes plan_offer`, missing)
  const moved = Object.keys(msgs[l].billing_page).filter(k => /^(starter|pro|business)_f\d$|^period_(monthly|semiannual|annual)$|^badge_|^per_(month|6months|3months|year)$|^per_month_equiv$/.test(k))
  ok(moved.length === 0, `${l} : plus de copie dans billing_page`, moved)
  ok(!('f1' in msgs[l].landing.pricing) && !('payment_stripe' in msgs[l].landing), `${l} : anciennes lignes de l'accueil et Stripe retirés`)
  ok(typeof msgs[l].billing_page.switch_on === 'string' && /\{plan\}/.test(msgs[l].billing_page.switch_on) && /\{date\}/.test(msgs[l].billing_page.switch_on), `${l} : « Passer à {plan} le {date} »`)
  const all = JSON.stringify([po, msgs[l].billing_page, msgs[l].landing.pricing])
  ok(!/[—–]/.test(JSON.stringify(po)) && !/\(s\)/.test(all), `${l} : ni tiret long ni « (s) »`)
  ok(!/Stripe/i.test(JSON.stringify([msgs[l].billing_page.online_payment_soon_desc, msgs[l].billing_page.stripe_coming_soon_title, msgs[l].billing_page.stripe_coming_soon_desc, msgs[l].billing_page.secure_payment_stripe_soon, po.pay_soon])), `${l} : Stripe n'est plus annoncé`)
}
const fr = msgs.fr
ok(fr.billing_page.change_plan === 'Changer de formule' && fr.billing_page.choose_plan === 'Choisir une formule' && fr.saas.choose_plan === 'Choisir une formule', 'fr : « formule » (Abonnement, mur de paiement)')
ok(!/contacte-nous|envoie-nous|\bton\b/i.test(JSON.stringify([fr.billing_page.meanwhile_contact, fr.billing_page.email_us_plan, fr.billing_page.stripe_coming_soon_desc])), 'fr : vouvoiement')
ok(/tout le Pro/.test(fr.landing.pricing.note), 'fr : l\'essai donne tout le Pro')

console.log('\n6. Branchements')
const layout = read('app/[locale]/layout.tsx'), landing = read('app/[locale]/page.tsx'), billing = read('app/[locale]/(app)/billing/page.tsx'), geo = read('app/api/geo/route.ts')
ok(/PUBLIC_NAMESPACES = \[[^\]]*'plan_offer'/.test(layout), 'textes communs envoyés aux pages publiques')
ok(/PLAN_LINE_KEYS/.test(landing) && /PLAN_LINE_KEYS/.test(billing), 'mêmes lignes sur l\'accueil et sur Abonnement')
ok(/fetch\('\/api\/geo'\)/.test(landing) && /countryChosen\.current/.test(landing), 'accueil : pays de l\'hébergeur, sans écraser un choix du visiteur')
ok(!/payment_stripe/.test(landing) && /landing-pay-soon/.test(landing), 'accueil : plus de Stripe annoncé')
ok(/getPeriodPrice\(plan\.monthly, period\)/.test(landing), 'accueil : prix de la durée choisie')
ok(/x-vercel-ip-country/.test(geo) && /no-store/.test(geo) && !/supabase|createClient/.test(geo), '/api/geo : pays seulement, sans base, sans cache partagé')
ok(/isDowngrade\(shop\?\.plan, id\)/.test(billing) && /t\('switch_on'/.test(billing), 'Abonnement : date sur le bouton d\'une formule moins chère')
ok(/billing-pay-soon/.test(billing), 'Abonnement : paiement pas encore ouvert dit avant le clic')
ok(!/from '\.\/entity'|from '@\/lib\/supabase/.test(read('lib/saas/plan-offer.ts') + read('lib/saas/plan-feature-rules.ts')), 'règles d\'affichage sans import serveur')

console.log(`\n${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
