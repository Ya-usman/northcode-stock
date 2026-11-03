// Options payantes (tarification du 3 nov. 2026, étape 2) : règle unique lib/saas/addons, confirmation du paiement.
// Usage : npx tsx tests/e2e/addons-pure.ts
import { readFileSync } from 'fs'
import {
  maxShopAddons, parseAddons, activeAddons, renewalAddons, addonsMonthly, roundUpCurrency, prorataQuote, periodPriceWithAddons,
  upgradeAdvice, addPurchasedAddons, applyRenewalAddons, MAX_ADDON_SEATS,
} from '../../lib/saas/addons'
import { getCountry } from '../../lib/saas/countries'
import { settlePayment, type PaymentIntent } from '../../lib/billing/payment-intents'

let ok = 0, ko = 0
const check = (label: string, cond: boolean, detail?: unknown) => { if (cond) { ok++; console.log('  ✓', label) } else { ko++; console.log('  ✗', label, detail === undefined ? '' : JSON.stringify(detail).slice(0, 300)) } }
const DAY = 86_400_000
const NOW = new Date('2026-11-03T12:00:00Z')
const CI = getCountry('CI'), FR = getCountry('FR')

;(async () => {
  console.log('1. Prix et plafonds')
  check('prix FCFA : employé 1 500, boutique 4 000 ; Europe : 5 € et 12 €', CI.addons.seat === 1500 && CI.addons.shop === 4000 && FR.addons.seat === 5 && FR.addons.shop === 12)
  check('boutiques en plus : Starter 2, Pro 1, Business 0 (3 boutiques en tout), essai 0', maxShopAddons('starter') === 2 && maxShopAddons('pro') === 1 && maxShopAddons('business') === 0 && maxShopAddons('trial') === 0)
  check('employés en plus : 20 au plus', MAX_ADDON_SEATS === 20)
  check('options lues bornées (valeurs hors plage ramenées)', JSON.stringify(parseAddons({ addon_seats: 25, addon_shops: -1, addon_seats_renew: null, addon_shops_renew: 1 })) === JSON.stringify({ seats: 20, shops: 0, seatsRenew: null, shopsRenew: 1 }))
  check('pendant l\'essai : les options ne comptent pas', JSON.stringify(activeAddons('trial', parseAddons({ addon_seats: 3, addon_shops: 1 }))) === '{"seats":0,"shops":0}')
  check('Pro avec 2 boutiques payées : 1 seule compte (plafond de 3 boutiques)', activeAddons('pro', parseAddons({ addon_seats: 0, addon_shops: 2 })).shops === 1)

  console.log('\n2. Prorata (achat en cours de période)')
  const in18 = new Date(NOW.getTime() + 18 * DAY).toISOString()
  let q = prorataQuote({ prices: CI.addons, seats: 1, shops: 0, planExpiresAt: in18, billingPeriod: 'monthly', currency: 'XOF', now: NOW })
  check('1 employé, 18 jours restants, mensuel : 1 500 × 18 / 30 = 900 F', q?.amount === 900 && q?.days === 18, q)
  q = prorataQuote({ prices: CI.addons, seats: 0, shops: 1, planExpiresAt: in18, billingPeriod: 'annual', currency: 'XOF', now: NOW })
  check('abonné annuel : remise de la durée (10/12) : 4 000 × 10/12 × 18/30 = 2 000 F', q?.amount === 2000, q)
  q = prorataQuote({ prices: CI.addons, seats: 1, shops: 0, planExpiresAt: new Date(NOW.getTime() + 7 * DAY + 3600_000).toISOString(), billingPeriod: 'monthly', currency: 'XOF', now: NOW })
  check('jour entamé compté (7 j + 1 h = 8 jours) : 400 F', q?.days === 8 && q?.amount === 400, q)
  q = prorataQuote({ prices: CI.addons, seats: 1, shops: 0, planExpiresAt: new Date(NOW.getTime() + 13 * DAY).toISOString(), billingPeriod: 'monthly', currency: 'XOF', now: NOW })
  check('arrondi FCFA toujours vers le haut (650 F)', q?.amount === 650, q)
  q = prorataQuote({ prices: FR.addons, seats: 1, shops: 0, planExpiresAt: new Date(NOW.getTime() + 10 * DAY).toISOString(), billingPeriod: 'monthly', currency: 'EUR', now: NOW })
  check('euros : 2 décimales (5 × 10 / 30 = 1,67 €)', q?.amount === 1.67, q)
  check('moins de 3 jours avant le renouvellement : achat refusé', prorataQuote({ prices: CI.addons, seats: 1, shops: 0, planExpiresAt: new Date(NOW.getTime() + 2 * DAY).toISOString(), billingPeriod: 'monthly', currency: 'XOF', now: NOW }) === null)
  check('abonnement terminé ou sans date : achat refusé', prorataQuote({ prices: CI.addons, seats: 1, shops: 0, planExpiresAt: new Date(NOW.getTime() - DAY).toISOString(), billingPeriod: 'monthly', currency: 'XOF', now: NOW }) === null
    && prorataQuote({ prices: CI.addons, seats: 1, shops: 0, planExpiresAt: null, billingPeriod: 'monthly', currency: 'XOF', now: NOW }) === null)
  check('arrondi vers le haut, jamais moins que le prorata exact', roundUpCurrency(899.01, 'XOF') === 900 && roundUpCurrency(1.661, 'EUR') === 1.67 && roundUpCurrency(900, 'XOF') === 900)

  console.log('\n3. Renouvellement')
  const a = parseAddons({ addon_seats: 3, addon_shops: 2, addon_seats_renew: 1, addon_shops_renew: null })
  check('retrait programmé appliqué (3 → 1 employé), boutiques reconduites (2)', JSON.stringify(renewalAddons(a, 'starter')) === '{"seats":1,"shops":2}')
  check('passage à Pro : 1 boutique en plus au plus (3 en tout)', renewalAddons(a, 'pro').shops === 1)
  check('passage à Business : aucune boutique en plus', renewalAddons(a, 'business').shops === 0)
  check('Starter mensuel + 2 employés : 5 000 + 3 000 = 8 000 F', periodPriceWithAddons(5000, CI.addons, 2, 0, 'monthly') === 8000)
  check('Starter 1 an + 1 boutique : (5 000 + 4 000) × 10 = 90 000 F', periodPriceWithAddons(5000, CI.addons, 0, 1, 'annual') === 90000)
  check('Pro 6 mois + 1 employé : (10 000 + 1 500) × 5,5 = 63 250 F', periodPriceWithAddons(10000, CI.addons, 1, 0, 'semiannual') === 63250)
  check('prix mensuel des options', addonsMonthly(CI.addons, 2, 1) === 7000)

  console.log('\n4. Conseil')
  const pp = { starter: 5000, pro: 10000, business: 15000 }
  let adv = upgradeAdvice('starter', pp, CI.addons, 3, 1)
  check('Starter + 3 employés + 1 boutique (13 500 F) : Pro (2 boutiques, 5 employés) pour 0 F de plus', adv?.plan === 'pro' && adv?.extraMonthly === 0, adv)
  adv = upgradeAdvice('starter', pp, CI.addons, 0, 2)
  check('Starter + 2 boutiques (13 000 F) : Pro ne couvre pas 3 boutiques, rien', adv === null, adv)
  adv = upgradeAdvice('pro', pp, CI.addons, 2, 1)
  check('Pro + 2 employés + 1 boutique (17 000 F) : Business pour 0 F de plus', adv?.plan === 'business' && adv?.extraMonthly === 0, adv)
  adv = upgradeAdvice('starter', pp, CI.addons, 1, 0)
  check('Starter + 1 employé (6 500 F) : Pro bien plus cher, rien', adv === null)
  check('Business : rien au-dessus', upgradeAdvice('business', pp, CI.addons, 5, 0) === null)

  console.log('\n5. Écriture après paiement')
  const db: any = { entities: { e1: { id: 'e1', addon_seats: 19, addon_shops: 1, addon_seats_renew: 18, addon_shops_renew: null } } }
  const updates: any[] = []
  const mk = () => ({
    from: (tb: string) => {
      const f: Record<string, any> = {}; let patch: any = null
      const q: any = {
        select: () => q, eq: (c: string, v: any) => { f[c] = v; return q },
        maybeSingle: async () => ({ data: db[tb][f.id] ?? null }),
        update: (p: any) => { patch = p; return q },
        then: (res: any) => res({ error: null }),
      }
      const origSelect = q.select
      q.select = (...args: any[]) => {
        if (patch) {
          const row = db[tb][f.id]
          const match = row && Object.entries(f).every(([k, v]) => row[k] === v)
          if (match) { Object.assign(row, patch); updates.push(patch) }
          return Promise.resolve({ data: match ? [{ id: f.id }] : [] })
        }
        return origSelect(...args)
      }
      return q
    },
  })
  const added = await addPurchasedAddons(mk(), 'e1', 'starter', 3, 2)
  check('achat de 3 employés à 19 payés : 1 seul ajouté (plafond 20) ; 2 boutiques à 1 payée en Starter : 1 ajoutée', JSON.stringify(added) === '{"seats":1,"shops":1}', added)
  check('retrait programmé relevé d\'autant (18 → 19), boutiques « idem »', db.entities.e1.addon_seats === 20 && db.entities.e1.addon_shops === 2 && db.entities.e1.addon_seats_renew === 19 && db.entities.e1.addon_shops_renew === null, db.entities.e1)

  console.log('\n6. Confirmation d\'un paiement « option »')
  const audits: any[] = []
  const intent: PaymentIntent = {
    id: 'pi', reference: 'SS-x-opt', gateway: 'flutterwave', gateway_reference: null, entity_id: 'e1', shop_id: 's1', owner_id: 'u', plan: 'pro',
    billing_period: 'monthly', currency: 'XOF', amount: 900, credit_applied: 0, amount_due: 900, auto_renew: false, status: 'pending',
    kind: 'addon', addon_seats: 1, addon_shops: 0, period_end: new Date(NOW.getTime() + 18 * DAY).toISOString(),
  }
  const admin = {
    from: (t: string) => {
      const q: any = { _t: t }
      for (const k of ['select', 'eq', 'in', 'is', 'order', 'limit', 'gte']) q[k] = () => q
      q.update = () => ({ eq: () => ({ eq: () => ({ select: async () => ({ data: [{ id: 'pi' }] }), then: (r: any) => r({}) }) }) })
      q.insert = (row: any) => { if (t === 'audit_logs') audits.push(row); if (t === 'subscriptions') audits.push({ subscription: row }); return { select: () => ({ single: async () => ({ data: { id: 'sub' } }) }), then: (res: any) => res({}) } }
      q.maybeSingle = async () => ({ data: null }); q.single = async () => ({ data: null })
      q.then = (res: any) => res({ data: [], error: null })
      return q
    },
    rpc: async () => ({}),
  }
  const req = new Request('http://x')
  const low = await settlePayment(admin, { ...intent }, { amount: 800, currency: 'XOF' }, req)
  check('payé moins que le prorata préparé : « à vérifier », rien d\'activé', low.status === 'review' && (low as any).reason === 'amount_too_low', low)
  const res = await settlePayment(admin, { ...intent }, { amount: 900, currency: 'XOF' }, req)
  check('montant exact : activé', res.status === 'activated', res)
  check('aucun abonnement créé pour une option (pas de nouvelle période)', !audits.some(a => a.subscription), audits)

  console.log('\n7. Branchements (sources)')
  const src = (p: string) => readFileSync(p, 'utf8')
  check('limites : équipe et boutiques comptent les options', src('lib/saas/team-quota.ts').includes('bonus.team_seats + purchased') && src('lib/saas/team-quota.ts').includes('bonus.shops + purchased'))
  check('remise en ordre : une option payée n\'est jamais mise en pause', src('lib/saas/enforce-limits.ts').includes('bonus.shops + paid.shops') && src('lib/saas/enforce-limits.ts').includes('bonus.team_seats + paid.seats'))
  check('renouvellement : prix formule + options, quantités préparées', src('app/api/billing/subscribe/route.ts').includes('periodPriceWithAddons(monthlyPrice, country.addons, renew.seats, renew.shops, period)') && src('app/api/billing/subscribe/route.ts').includes("kind: 'plan', addon_seats: renew.seats, addon_shops: renew.shops"))
  check('confirmation : options du renouvellement appliquées', src('lib/billing/payment-intents.ts').includes('applyRenewalAddons(admin, account.entityId'))
  check('achat : propriétaire seulement, prix et prorata calculés par le serveur', src('app/api/billing/addons/route.ts').includes("account.ownerId === user.id || role === 'owner'") && src('app/api/billing/addons/route.ts').includes('prorataQuote({ prices: country.addons'))
  check('retrait : jamais plus que ce qui est payé', src('app/api/billing/addons/route.ts').includes('v.data.seats > addons.seats || v.data.shops > addons.shops'))
  void applyRenewalAddons

  console.log(`\n${ok} réussis, ${ko} échec(s)`)
  process.exit(ko ? 1 : 0)
})().catch(e => { console.error('ERREUR', e); process.exit(1) })
