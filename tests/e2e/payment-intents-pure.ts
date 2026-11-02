// Paiements préparés par le serveur (migration 204, 3 nov. 2026) : confirmation commune à toutes les passerelles.
// Base simulée en mémoire (aucun accès réseau ni base réelle).
// Usage : npx tsx tests/e2e/payment-intents-pure.ts
import { findPaymentIntent, settlePayment, newPaymentReference, type PaymentIntent } from '../../lib/billing/payment-intents'

let ok = 0, ko = 0
const check = (label: string, cond: boolean, detail?: unknown) => { if (cond) { ok++; console.log('  ✓', label) } else { ko++; console.log('  ✗', label, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300)) } }

// ── Base simulée : filtres eq, update conditionnel, insert ──
type Row = Record<string, any>
function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed))
  const log: string[] = []
  const from = (table: string) => {
    const filters: [string, any][] = []
    let op: 'select' | 'update' | 'insert' = 'select'; let patch: Row | null = null; let returning = false
    const rows = () => (tables[table] ||= []).filter(r => filters.every(([k, v]) => r[k] === v))
    const run = () => {
      if (op === 'insert') { const r = { id: `${table}-${(tables[table] ||= []).length + 1}`, ...patch }; tables[table].push(r); log.push(`insert ${table}`); return { data: r, error: null } }
      if (op === 'update') { const hit = rows(); hit.forEach(r => Object.assign(r, patch)); log.push(`update ${table} ${hit.length}`); return { data: returning ? hit.map(r => ({ id: r.id })) : null, error: null } }
      return { data: rows(), error: null }
    }
    const q: any = {
      select: () => { if (op !== 'select') returning = true; return q },
      eq: (k: string, v: any) => { filters.push([k, v]); return q },
      in: () => q, is: () => q, gt: () => q, gte: () => q, lt: () => q, order: () => q, limit: () => q, neq: () => q,
      update: (p: Row) => { op = 'update'; patch = p; return q },
      insert: (p: Row) => { op = 'insert'; patch = p; return q },
      maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null } },
      single: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null } },
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    }
    return q
  }
  return { admin: { from, rpc: async () => ({ data: null, error: null }) }, tables, log }
}

const SHOP = 'a0000000-0000-0000-0000-000000000001', ENTITY = 'e0000000-0000-0000-0000-000000000001'
const intentRow = (over: Partial<PaymentIntent> = {}): Row => ({
  id: 'pi-1', reference: 'SS-a0000000-test-0001', gateway: 'flutterwave', gateway_reference: null, entity_id: ENTITY, shop_id: SHOP,
  owner_id: 'u-owner', plan: 'pro', billing_period: 'annual', currency: 'XOF', amount: '55000.00', credit_applied: '0', amount_due: '55000.00',
  auto_renew: false, status: 'pending', ...over,
})
const seed = (over: Partial<PaymentIntent> = {}) => ({
  payment_intents: [intentRow(over)],
  shops: [{ id: SHOP, entity_id: ENTITY, owner_id: 'u-owner', agent_id: 'ag-1', country: 'NE', billing_country: 'NE' }],
  entities: [{ id: ENTITY, name: 'SOFAR', owner_user_id: 'u-owner', plan: 'trial', plan_expires_at: null, trial_ends_at: '2026-11-20', billing_country: 'NE' }],
  agents: [{ id: 'ag-1', commission_rate: 10 }],
})
const req = new Request('http://localhost/api/billing/flutterwave/verify')

;(async () => {
  console.log('1. Référence')
  const r1 = newPaymentReference(SHOP), r2 = newPaymentReference(SHOP)
  check(`référence unique, de 8 à 80 caractères (« ${r1} »)`, r1 !== r2 && r1.length >= 8 && r1.length <= 80 && r1.startsWith('SS-a0000000-'))

  console.log('\n2. Bon montant, bonne devise : activé une seule fois')
  let db = fakeDb(seed())
  const intent = await findPaymentIntent(db.admin, 'flutterwave', { reference: 'SS-a0000000-test-0001' })
  check('préparation retrouvée par notre référence (montants en nombres)', !!intent && intent.amount_due === 55000 && intent.plan === 'pro')
  check('mauvaise passerelle : rien', (await findPaymentIntent(db.admin, 'paystack', { reference: 'SS-a0000000-test-0001' })) === null)
  check('référence inconnue : rien', (await findPaymentIntent(db.admin, 'flutterwave', { reference: 'SS-faux' })) === null)
  const first = await settlePayment(db.admin, intent!, { amount: 55000, currency: 'xof', gatewayTxId: 'flw-1' }, req)
  check('activé', first.status === 'activated', first)
  check('préparation réglée (« paid », montant et devise confirmés gardés)', db.tables.payment_intents[0].status === 'paid' && db.tables.payment_intents[0].paid_amount === 55000 && db.tables.payment_intents[0].paid_currency === 'XOF')
  const ent = db.tables.entities[0]
  const days = Math.round((new Date(ent.plan_expires_at).getTime() - Date.now()) / 86400000)
  check(`entreprise : Pro, 1 an (${days} jours), fin de l’essai effacée`, ent.plan === 'pro' && days >= 364 && days <= 366 && ent.trial_ends_at === null, ent)
  const sub = db.tables.subscriptions?.[0]
  check('abonnement enregistré avec NOTRE référence et la formule préparée', !!sub && sub.paystack_reference === 'SS-a0000000-test-0001' && sub.plan === 'pro' && sub.billing_period === 'annual' && sub.gateway === 'flutterwave')
  const com = db.tables.agent_commissions?.[0]
  check('commission de l’agent pour Flutterwave aussi (10 % de 55 000, en XOF)', !!com && com.commission_amount === 5500 && com.currency === 'XOF')
  const again = await settlePayment(db.admin, { ...intent!, status: 'pending' }, { amount: 55000, currency: 'XOF' }, req)
  check('2e confirmation (retour en double) : « déjà fait », rien de plus', again.status === 'already' && db.tables.subscriptions.length === 1 && db.tables.agent_commissions.length === 1, again)
  const reread = await findPaymentIntent(db.admin, 'flutterwave', { reference: 'SS-a0000000-test-0001' })
  check('relue après règlement : « déjà fait »', (await settlePayment(db.admin, reread!, { amount: 55000, currency: 'XOF' }, req)).status === 'already')

  console.log('\n3. Montant trop bas ou mauvaise devise : rien n’est activé')
  db = fakeDb(seed())
  let it = (await findPaymentIntent(db.admin, 'flutterwave', { reference: 'SS-a0000000-test-0001' }))!
  const low = await settlePayment(db.admin, it, { amount: 100, currency: 'XOF', gatewayTxId: 'flw-2' }, req)
  check('100 F au lieu de 55 000 : « à vérifier » (amount_too_low)', low.status === 'review' && (low as any).reason === 'amount_too_low', low)
  check('… formule inchangée (essai), aucun abonnement, aucune commission', db.tables.entities[0].plan === 'trial' && !db.tables.subscriptions?.length && !db.tables.agent_commissions?.length)
  check('… préparation « review » avec ce qui a été payé', db.tables.payment_intents[0].status === 'review' && db.tables.payment_intents[0].paid_amount === 100 && db.tables.payment_intents[0].review_reason === 'amount_too_low')
  check('… une préparation « review » ne s’active jamais ensuite', (await settlePayment(db.admin, { ...it, status: 'review' }, { amount: 55000, currency: 'XOF' }, req)).status === 'review' && db.tables.entities[0].plan === 'trial')
  db = fakeDb(seed())
  it = (await findPaymentIntent(db.admin, 'flutterwave', { reference: 'SS-a0000000-test-0001' }))!
  const cur = await settlePayment(db.admin, it, { amount: 55000, currency: 'NGN' }, req)
  check('55 000 NGN au lieu de 55 000 XOF : « à vérifier » (currency_mismatch)', cur.status === 'review' && (cur as any).reason === 'currency_mismatch' && db.tables.entities[0].plan === 'trial', cur)
  db = fakeDb(seed())
  it = (await findPaymentIntent(db.admin, 'flutterwave', { reference: 'SS-a0000000-test-0001' }))!
  check('montant illisible : « à vérifier »', (await settlePayment(db.admin, it, { amount: NaN, currency: 'XOF' }, req)).status === 'review')
  db = fakeDb(seed({ billing_period: 'weekly' } as any))
  it = (await findPaymentIntent(db.admin, 'flutterwave', { reference: 'SS-a0000000-test-0001' }))!
  check('durée inconnue : « à vérifier », jamais d’erreur', (await settlePayment(db.admin, it, { amount: 55000, currency: 'XOF' }, req)).status === 'review' && db.tables.entities[0].plan === 'trial')
  db = fakeDb(seed())
  it = (await findPaymentIntent(db.admin, 'flutterwave', { reference: 'SS-a0000000-test-0001' }))!
  check('arrondi d’un centime (54 999,995) : accepté', (await settlePayment(db.admin, it, { amount: 54999.995, currency: 'XOF' }, req)).status === 'activated')

  console.log('\n4. Crédit de parrainage et passerelles')
  db = fakeDb(seed({ credit_applied: 5000, amount_due: 50000 } as any))
  it = (await findPaymentIntent(db.admin, 'flutterwave', { reference: 'SS-a0000000-test-0001' }))!
  check('crédit de 5 000 réservé : 50 000 payés suffisent', (await settlePayment(db.admin, it, { amount: 50000, currency: 'XOF' }, req)).status === 'activated')
  db = fakeDb({ ...seed(), payment_intents: [intentRow({ gateway: 'wave', gateway_reference: 'cos-123' } as any)] })
  check('Wave : retrouvée par la session gardée à la création', (await findPaymentIntent(db.admin, 'wave', { gatewayReference: 'cos-123' }))?.id === 'pi-1')
  db = fakeDb({ ...seed(), payment_intents: [intentRow({ gateway: 'notchpay', gateway_reference: 'trx.abc' } as any)] })
  check('NotchPay : retrouvée par la référence NotchPay, ou par notre référence', (await findPaymentIntent(db.admin, 'notchpay', { gatewayReference: 'trx.abc' }))?.id === 'pi-1' && (await findPaymentIntent(db.admin, 'notchpay', { gatewayReference: 'trx.zzz', reference: 'SS-a0000000-test-0001' }))?.id === 'pi-1')

  console.log(`\n${ok} réussis, ${ko} échec(s)`)
  process.exit(ko ? 1 : 0)
})().catch(e => { console.error('ERREUR', e); process.exit(1) })
