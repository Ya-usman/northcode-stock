// Formule choisie sur la page Tarifs (lot D du 7 nov. 2026) : lecture des paramètres, et branchements (page Tarifs →
// inscription → compte → page Abonnement). Usage : npx tsx tests/e2e/chosen-offer-pure.ts
import { readFileSync } from 'fs'
import { parseChosenOffer, planName } from '../../lib/site/chosen-offer'

let pass = 0, fail = 0
const ok = (c: boolean, m: string, x?: unknown) => { c ? pass++ : fail++; console.log(`  ${c ? 'ok   ' : 'ÉCHEC'} ${m}${!c && x !== undefined ? ' → ' + JSON.stringify(x) : ''}`) }
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

ok(eq(parseChosenOffer('pro', 'annual'), { plan: 'pro', period: 'annual' }), 'pro + 1 an')
ok(eq(parseChosenOffer('business', 'semiannual'), { plan: 'business', period: 'semiannual' }), 'business + 6 mois')
ok(eq(parseChosenOffer('starter', null), { plan: 'starter', period: 'monthly' }), 'durée absente : mensuel')
ok(eq(parseChosenOffer('pro', 'quarterly'), { plan: 'pro', period: 'monthly' }), 'durée retirée de l\'offre (trimestre) : mensuel')
ok(eq(parseChosenOffer('pro', 'forever'), { plan: 'pro', period: 'monthly' }), 'durée inconnue : mensuel')
for (const bad of ['free', 'PRO', '', null, undefined, 42, '<script>']) ok(parseChosenOffer(bad as any, 'annual') === null, `formule refusée : ${JSON.stringify(bad)}`)
ok(planName('business') === 'Business', 'nom affiché de la formule')

const src = (f: string) => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')
ok(/register\?plan=\$\{plan\.id\}&period=\$\{period\}/.test(src('components/marketing/pricing-section.tsx')), 'Tarifs : chaque formule mène à l\'inscription avec formule ET durée')
const reg = src('app/[locale]/(auth)/register/page.tsx')
ok(/parseChosenOffer\(q\.get\('plan'\), q\.get\('period'\)\)/.test(reg) && /storeOffer\(fromUrl\)/.test(reg), 'inscription : paramètres lus, contrôlés, gardés sur l\'appareil')
ok(/chosen_plan: chosenOffer\?\.plan/.test(reg) && /chosen_period: chosenOffer\?\.period/.test(reg), 'inscription : choix envoyé au serveur')
const api = src('app/api/register/route.ts')
ok(/parseChosenOffer\(validated\.data\.chosen_plan, validated\.data\.chosen_period\)/.test(api) && /chosen_offer: \{ \.\.\.chosenOffer/.test(api), 'serveur : choix recontrôlé puis gardé dans le compte')
const bill = src('app/[locale]/(app)/billing/page.tsx')
ok(/const offerFirst = isSubscribed \? null : chosenOffer/.test(bill), 'Abonnement : choix proposé en premier seulement sans abonnement actif')
ok(/user_metadata\?\.chosen_offer/.test(bill) && /readStoredOffer\(\)/.test(bill), 'Abonnement : choix lu dans le compte, sinon sur l\'appareil (inscription Google)')

console.log(`\n${pass} réussis, ${fail} échec(s)`)
process.exit(fail ? 1 : 0)
