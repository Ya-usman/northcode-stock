// Pays de tarification (migration 208, règles du 3 nov. 2026) : situations réelles.
// Usage : npx tsx tests/e2e/pricing-country-pure.ts
import { resolvePricingCountry, priceZone, activityMajority, requestCountry } from '../../lib/saas/pricing-country'
import { settlePayment, type PaymentIntent } from '../../lib/billing/payment-intents'

let ok = 0, ko = 0
const check = (label: string, cond: boolean, detail?: unknown) => { if (cond) { ok++; console.log('  ✓', label) } else { ko++; console.log('  ✗', label, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300)) } }
const P = (declared: string, activity: [string, number][], override?: string | null) =>
  resolvePricingCountry({ declared, override, activity: activity.map(([country, ops]) => ({ country, ops })) })

;(async () => {
  console.log('1. Zones')
  check('Niger, Inde : zone 1 ; Brésil : zone 2 ; France, États-Unis : zone 3', priceZone('NE') === 1 && priceZone('IN') === 1 && priceZone('BR') === 2 && priceZone('FR') === 3 && priceZone('US') === 3)
  check('pays inconnu de l’application : zone la plus chère (jamais un rabais par défaut)', priceZone('ZZ') === 3 && priceZone(null) === 3)

  console.log('\n2. Situations')
  let r = P('NE', [['NE', 180], ['FR', 6]])
  check('boutique au Niger, propriétaire en voyage en France (6 opérations sur 186) : prix du Niger', r.country === 'NE' && r.reason === 'declared', r)
  r = P('NE', [['NE', 120]])
  check('diaspora : activité au Niger (la carte française n’entre pas en compte) : prix du Niger', r.country === 'NE')
  r = P('ML', [['FR', 95], ['ML', 5]])
  check('déclarée au Mali, 95 % de l’activité en France : prix de la France', r.country === 'FR' && r.reason === 'activity' && Math.round(r.activityShare * 100) === 95, r)
  r = P('ML', [['FR', 60], ['ML', 40]])
  check('60 % en France seulement (sous 70 %) : prix du Mali', r.country === 'ML' && r.reason === 'declared')
  r = P('ML', [['FR', 15]])
  check('15 opérations seulement (moins de 20) : pas assez pour juger, prix du Mali', r.country === 'ML' && r.activityCountry === null)
  r = P('FR', [['ML', 100]])
  check('déclarée en France, activité au Mali : jamais de baisse automatique (prix de la France)', r.country === 'FR')
  r = P('BR', [['US', 100]])
  check('déclarée au Brésil, activité aux États-Unis (zone plus chère) : prix des États-Unis', r.country === 'US')
  r = P('KE', [['UG', 100]])
  check('Kenya → Ouganda (même zone) : prix du Kenya', r.country === 'KE')
  r = P('NE', [['FR', 100]], 'NE')
  check('pays fixé par l’équipe : il l’emporte toujours', r.country === 'NE' && r.reason === 'override')
  r = P('NE', [['FR', 100]], 'ZZ')
  check('pays fixé inconnu : ignoré', r.country === 'FR' && r.reason === 'activity')
  check('majorité calculée sur la somme par pays', JSON.stringify(activityMajority([{ country: 'NE', ops: 10 }, { country: 'FR', ops: 12 }, { country: 'NE', ops: 5 }])) === JSON.stringify({ country: 'NE', share: 15 / 27, total: 27 }))

  console.log('\n3. Pays de la requête : celui de l’hébergeur seulement')
  const req = (h: Record<string, string>) => new Request('http://x', { headers: h })
  check('x-vercel-ip-country lu', requestCountry(req({ 'x-vercel-ip-country': 'ne' })) === 'NE')
  check('x-user-country (envoyé par l’appareil) ignoré', requestCountry(req({ 'x-user-country': 'ML' })) === null)
  check('valeurs inconnues (XX, T1) ignorées', requestCountry(req({ 'x-vercel-ip-country': 'XX' })) === null && requestCountry(req({ 'x-vercel-ip-country': 'T1' })) === null)

  console.log('\n4. Après paiement : écart signalé, jamais bloqué')
  const audits: any[] = []
  const rows: any = { payment_intents: [] }
  const mk = (over: Partial<PaymentIntent>): PaymentIntent => ({ id: 'pi', reference: 'SS-x-1', gateway: 'flutterwave', gateway_reference: null, entity_id: null, shop_id: 's1', owner_id: 'u', plan: 'pro', billing_period: 'monthly', currency: 'XOF', amount: 10000, credit_applied: 0, amount_due: 10000, auto_renew: false, status: 'pending', request_country: 'FR', pricing_reason: 'declared', pricing_country: 'NE', ...over })
  const admin = {
    from: (t: string) => {
      const q: any = { _t: t }
      for (const k of ['select', 'eq', 'in', 'is', 'order', 'limit', 'gte']) q[k] = () => q
      q.update = () => ({ eq: () => ({ eq: () => ({ select: async () => ({ data: [{ id: 'pi' }] }), then: (r: any) => r({}) }) }) })
      q.insert = (row: any) => { if (t === 'audit_logs') audits.push(row); return { select: () => ({ single: async () => ({ data: { id: 'sub' } }) }), then: (res: any) => res({}) } }
      q.maybeSingle = async () => ({ data: null }); q.single = async () => ({ data: null })
      q.then = (res: any) => res({ data: [], error: null })
      return q
    },
    rpc: async () => ({}),
  }
  void rows
  // writeAuditLog crée son propre client : on observe le résultat de settlePayment (aucune exception, activé)
  const res = await settlePayment(admin, mk({}), { amount: 10000, currency: 'XOF', payerCountry: 'FR' }, req({}))
  check('carte française + demande depuis la France, boutique tarifée au Niger : paiement accepté (activé)', res.status === 'activated', res)
  const res2 = await settlePayment(admin, mk({ request_country: 'NE' }), { amount: 10000, currency: 'XOF', payerCountry: 'FR' }, req({}))
  check('carte française, demande depuis le Niger (diaspora qui paie à distance, ou carte d’un proche) : activé', res2.status === 'activated')

  console.log(`\n${ok} réussis, ${ko} échec(s)`)
  process.exit(ko ? 1 : 0)
})().catch(e => { console.error('ERREUR', e); process.exit(1) })
