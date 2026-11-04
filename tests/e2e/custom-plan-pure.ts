// Offre sur mesure (tarification du 4 nov. 2026, étape 3) : règle unique lib/saas/custom-plan et branchements.
// Usage : npx tsx tests/e2e/custom-plan-pure.ts
import { readFileSync } from 'fs'
import {
  needsCustom, suggestedMonthly, quoteTotal, quoteState, quotePayable, customLimit, quoteExpiryReminderDue, priceReviewDue,
  QUOTE_VALID_DAYS, PRICE_GUARANTEE_DAYS, type QuoteRow,
} from '../../lib/saas/custom-plan'
import { getCountry } from '../../lib/saas/countries'
import { buildCustomQuoteDoc } from '../../lib/pdf/custom-quote-doc'

let ok = 0, ko = 0
const check = (label: string, cond: boolean, detail?: unknown) => { if (cond) { ok++; console.log('  ✓', label) } else { ko++; console.log('  ✗', label, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300)) } }
const NOW = new Date('2026-11-04T12:00:00Z')
const DAY = 86_400_000
const iso = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString()
const CI = getCountry('CI'), FR = getCountry('FR')
const Q = (over: Partial<QuoteRow> = {}): QuoteRow => ({
  id: 'q1', entity_id: 'e1', status: 'quoted', req_shops: 5, req_seats: 12, req_period: 'annual',
  monthly_price: 29000, billing_period: 'annual', period_total: 290000, currency: 'XOF', limit_shops: 5, limit_seats: 12,
  valid_until: iso(10), price_until: null, token: 'tok', ...over,
})
const src = (p: string) => readFileSync(p, 'utf8')

console.log('1. À qui s\'adresse l\'offre')
check('4 boutiques : oui ; 3 boutiques et 10 employés : non (formules et options suffisent)', needsCustom(4, 0) && !needsCustom(3, 10))
check('3 boutiques mais 29 employés (au-delà de 8 + 20 en option) : oui', needsCustom(3, 29) && !needsCustom(3, 28))

console.log('\n2. Prix conseillé et total')
check('FCFA, 5 boutiques, 12 employés : 15 000 + 2 × 4 000 + 4 × 1 500 = 29 000 F', suggestedMonthly(CI.prices.business, CI.addons, 5, 12) === 29000)
check('Europe, 6 boutiques, 8 employés : 50 + 3 × 12 = 86 €', suggestedMonthly(FR.prices.business, FR.addons, 6, 8) === 86)
check('jamais en dessous de Business (3 boutiques, 5 employés : 15 000 F)', suggestedMonthly(CI.prices.business, CI.addons, 3, 5) === 15000)
check('1 an = 10 mois payés : 290 000 F ; 6 mois = 5,5 mois : 159 500 F', quoteTotal(29000, 'annual') === 290000 && quoteTotal(29000, 'semiannual') === 159500)
check('validité 15 jours, prix garanti 365 jours', QUOTE_VALID_DAYS === 15 && PRICE_GUARANTEE_DAYS === 365)

console.log('\n3. État et paiement')
check('devis envoyé dont la date est passée : « expiré » (même avant la tâche du matin)', quoteState(Q({ valid_until: iso(-1) }), NOW) === 'expired')
check('devis envoyé valable : payable (premier paiement)', quotePayable(Q(), null, NOW) === 'first')
check('devis expiré : non payable', quotePayable(Q({ valid_until: iso(-1) }), null, NOW) === null)
check('demande sans devis : non payable', quotePayable(Q({ status: 'requested', monthly_price: null, period_total: null }), null, NOW) === null)
check('devis payé, prix garanti, offre en cours de l\'entreprise : renouvellement possible', quotePayable(Q({ status: 'paid', price_until: iso(100) }), 'q1', NOW) === 'renewal')
check('devis payé mais l\'entreprise a une AUTRE offre en cours : non', quotePayable(Q({ status: 'paid', price_until: iso(100) }), 'q2', NOW) === null)
check('prix garanti terminé : non (nouveau devis)', quotePayable(Q({ status: 'paid', price_until: iso(-1) }), 'q1', NOW) === null)
check('devis refusé : non payable', quotePayable(Q({ status: 'declined' }), null, NOW) === null)

console.log('\n4. Limites')
check('Business sur mesure 5 boutiques : limite 5 (au lieu de 3)', customLimit(3, 'business', { shops: 5, seats: 12 }, 'shops') === 5)
check('employés : 12 (au lieu de 8)', customLimit(8, 'business', { shops: 5, seats: 12 }, 'team_members') === 12)
check('formule autre que Business : limites sur mesure ignorées', customLimit(2, 'pro', { shops: 5, seats: 12 }, 'shops') === 2)
check('jamais en dessous de la formule', customLimit(8, 'business', { shops: 5, seats: 4 }, 'team_members') === 8)
check('sans offre : limite de la formule ; illimité reste illimité', customLimit(3, 'business', null, 'shops') === 3 && customLimit(-1, 'business', { shops: 5, seats: 1 }, 'shops') === -1)

console.log('\n5. Rappels')
check('devis qui expire dans 2 jours : rappel au client', quoteExpiryReminderDue(Q({ valid_until: iso(2) }), new Set(), NOW) === 'q1:expiry')
check('déjà rappelé : rien ; dans 5 jours : trop tôt', quoteExpiryReminderDue(Q({ valid_until: iso(2) }), new Set(['q1:expiry']), NOW) === null && quoteExpiryReminderDue(Q({ valid_until: iso(5) }), new Set(), NOW) === null)
check('prix garanti qui finit dans 20 jours : alerte à l\'équipe', priceReviewDue(Q({ status: 'paid', price_until: iso(20) }), new Set(), NOW) === 'q1:review')
check('prix garanti dans 60 jours : rien', priceReviewDue(Q({ status: 'paid', price_until: iso(60) }), new Set(), NOW) === null)

console.log('\n6. Branchements (sources)')
check('paiement : montant LU DANS LE DEVIS, jamais envoyé par l\'écran', src('app/api/billing/custom/quote/route.ts').includes('const amount = Number(q.period_total)') && !/body\.(amount|monthly)/.test(src('app/api/billing/custom/quote/route.ts')))
check('paiement : propriétaire de l\'entreprise seulement (autre compte = « introuvable »)', src('app/api/billing/custom/quote/route.ts').includes('ent.owner_user_id !== user.id'))
check('confirmation : devis payé → limites du devis, sinon formule normale → offre sur mesure retirée (lib/saas/plan-change-server)', src('lib/billing/payment-intents.ts').includes("kind: intent.kind === 'custom' ? 'custom' : 'plan', quoteId: intent.quote_id") && src('lib/saas/plan-change-server.ts').includes("p.kind === 'custom' && p.quoteId) await applyCustomPlan") && src('lib/saas/plan-change-server.ts').includes('clearCustomPlan(admin, account.entityId)'))
check('formule normale refusée pendant une offre sur mesure en cours', src('app/api/billing/subscribe/route.ts').includes("code: 'custom_plan_active'"))
check('renouvellement automatique : jamais au prix Business normal pour une offre sur mesure', src('app/api/cron/renewal-check/route.ts').includes('offre sur mesure : renouvellement par le devis'))
check('limites : équipe, boutiques et remise en ordre lisent l\'offre sur mesure', src('lib/saas/team-quota.ts').split('customLimit(').length === 3 && src('lib/saas/enforce-limits.ts').split('customLimit(').length === 3)
check('demande : une seule ouverte à la fois ; minimum 4 boutiques', src('app/api/billing/custom/route.ts').includes("code: 'custom_already_open'") && src('app/api/billing/custom/route.ts').includes("code: 'custom_min'"))
check('admin : envoi, prolongation, refus réservés au super_admin', src('app/api/admin/custom-quotes/route.ts').includes("requireAdmin({ tier: 'super_admin' })"))

async function pdfCheck() {
  console.log('\n7. PDF du devis (fabriqué comme sur le serveur)')
  const { doc, fileName } = await buildCustomQuoteDoc({
    reference: 'DEV-ABCD1234', dateStr: '4 novembre 2026', validUntilStr: '19 novembre 2026', clientName: 'Marché Soleil', clientCountry: 'Cameroun',
    lines: [{ label: 'Formule Business sur mesure', detail: '5 boutiques, 12 employés', amount: '29 000 F CFA par mois' }, { label: 'Durée', detail: '1 an', amount: '348 000 F CFA → 290 000 F CFA' }],
    totalLabel: 'Total (1 an)', totalAmount: '290 000 F CFA', payUrl: 'https://stockshop.tech/fr/billing/quote/tok_TestDevisSurMesure_0123456789', note: 'Lalle ƙasa ɗaya',
    labels: { title: 'DEVIS SUR MESURE', reference: 'Référence', date: 'Date', validUntil: "Valable jusqu'au", client: 'Client', country: 'Pays', colItem: 'Désignation', colDetail: 'Détail', colAmount: 'Montant', pay: 'Payer en ligne', noteTitle: 'Message', footer: 'StockShop · support@stockshop.tech' },
  })
  const buf = Buffer.from(doc.output('arraybuffer') as ArrayBuffer)
  check(`PDF construit (${buf.length} octets, « ${fileName} »)`, buf.length > 2000 && buf.subarray(0, 5).toString() === '%PDF-' && fileName.endsWith('DEV-ABCD1234.pdf'))
}

pdfCheck().then(() => {
  console.log(`\n${ok} réussis, ${ko} échec(s)`)
  process.exit(ko ? 1 : 0)
}).catch(e => { console.error('ERREUR', e); process.exit(1) })
