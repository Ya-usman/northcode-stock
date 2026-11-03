// Paiements d'abonnement préparés par le serveur (migration 204, 3 nov. 2026) : UNE seule confirmation pour toutes les
// passerelles (Flutterwave, Paystack, NotchPay, Wave).
//
// Avant : chaque route /api/billing/*/verify lisait la formule et la durée dans les informations jointes au paiement
// (modifiables par qui crée le paiement) et ne comparait jamais le montant payé au prix ; la commission de l'agent et la
// remise en ordre des limites n'existaient que pour Paystack. Désormais :
//   1. /api/billing/subscribe PRÉPARE le paiement (createPaymentIntent) : notre référence, formule, durée, devise et
//      montant attendu, calculés par le serveur ;
//   2. la route de retour retrouve cette préparation par la référence (findPaymentIntent) et transmet ce que la
//      passerelle a confirmé ;
//   3. settlePayment vérifie devise et montant, règle la préparation UNE fois (mise à jour conditionnelle) et active
//      l'abonnement préparé. Montant ou devise différents : rien n'est activé, le paiement passe « à vérifier ».
// Un paiement qui ne correspond à aucune préparation (ancien lien, paiement fabriqué) n'active jamais rien.

import { randomBytes } from 'crypto'
import { BILLING_PERIODS, getPeriodDays, type BillingPeriod } from '@/lib/saas/countries'
import { getAccountForShop, setAccountPlan } from '@/lib/saas/entity'
import { enforceShopPlanLimits } from '@/lib/saas/enforce-limits'
import { processReferralReward } from '@/lib/referrals/process-reward'
import { applyWalletCredit } from '@/lib/referrals/apply-credit'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { priceZone } from '@/lib/saas/pricing-country'
import { addPurchasedAddons, applyRenewalAddons } from '@/lib/saas/addons'

export type Gateway = 'paystack' | 'notchpay' | 'flutterwave' | 'wave' | 'stripe'
export type PaidPlan = 'starter' | 'pro' | 'business'

export interface PaymentIntent {
  id: string
  reference: string
  gateway: Gateway
  gateway_reference: string | null
  entity_id: string | null
  shop_id: string
  owner_id: string | null
  plan: PaidPlan
  billing_period: BillingPeriod
  currency: string
  amount: number
  credit_applied: number
  amount_due: number
  auto_renew: boolean
  status: 'pending' | 'paid' | 'review' | 'failed'
  /** Pays de la demande (hébergeur) et raison du pays de tarification (migration 208) */
  request_country?: string | null
  pricing_reason?: 'declared' | 'activity' | 'override' | null
  pricing_country?: string | null
  /** Options (migration 210) : 'plan' = formule (addon_* = options du renouvellement) ; 'addon' = achat d'options en
   *  cours de période (addon_* = quantités ajoutées, period_end = fin de la période payée au prorata) */
  kind?: 'plan' | 'addon'
  addon_seats?: number
  addon_shops?: number
  period_end?: string | null
}

/** Notre référence de paiement : unique, sans information exploitable */
export function newPaymentReference(shopId: string): string {
  return `SS-${shopId.slice(0, 8)}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`
}

export async function createPaymentIntent(admin: any, row: Omit<PaymentIntent, 'id' | 'status' | 'gateway_reference'>): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await admin.from('payment_intents').insert({ ...row, status: 'pending' })
  return error ? { ok: false, error: error.message } : { ok: true }
}

/** Référence donnée par la passerelle à la création (session Wave, transaction NotchPay) */
export async function setGatewayReference(admin: any, reference: string, gatewayReference: string | null | undefined) {
  if (!gatewayReference) return
  await admin.from('payment_intents').update({ gateway_reference: String(gatewayReference).slice(0, 200) }).eq('reference', reference).eq('status', 'pending')
}

/** Préparation abandonnée (la passerelle a refusé de créer le paiement) */
export async function failPaymentIntent(admin: any, reference: string, reason: string) {
  await admin.from('payment_intents').update({ status: 'failed', review_reason: reason.slice(0, 300), settled_at: new Date().toISOString() }).eq('reference', reference).eq('status', 'pending')
}

/** Préparation correspondant à un retour de passerelle : par notre référence, sinon par la référence de la passerelle */
export async function findPaymentIntent(admin: any, gateway: Gateway, refs: { reference?: string | null; gatewayReference?: string | null }): Promise<PaymentIntent | null> {
  for (const [col, val] of [['reference', refs.reference], ['gateway_reference', refs.gatewayReference]] as const) {
    if (!val) continue
    const { data } = await admin.from('payment_intents').select('*').eq('gateway', gateway).eq(col, String(val)).maybeSingle()
    if (data) return { ...data, amount: Number(data.amount), credit_applied: Number(data.credit_applied), amount_due: Number(data.amount_due), addon_seats: Number(data.addon_seats ?? 0), addon_shops: Number(data.addon_shops ?? 0) }
  }
  return null
}

/** Ce que la passerelle a confirmé */
export interface ConfirmedPayment {
  amount: number
  currency: string | null | undefined
  gatewayTxId?: string | null
  /** Moyen réutilisable pour le renouvellement automatique (carte Paystack / Flutterwave) */
  authorization?: string | null
  email?: string | null
  last4?: string | null
  /** Pays du moyen de paiement (pays de la carte), si la passerelle le donne */
  payerCountry?: string | null
}

export type SettleResult = { status: 'activated' | 'already' } | { status: 'review'; reason: string }

/** Paiement confirmé sans préparation correspondante : jamais d'activation, trace pour l'administration */
export async function recordUnmatchedPayment(gateway: Gateway, info: { reference?: string | null; amount?: unknown; currency?: unknown }, request: Request) {
  await writeAuditLog({
    action: 'billing.payment_unmatched', shop_id: null, actor_id: null, target_id: String(info.reference ?? '').slice(0, 120) || null,
    target_type: `${gateway}_payment`, metadata: { gateway, amount: info.amount ?? null, currency: info.currency ?? null }, ip: getClientIp(request),
  } as any)
}

/** Vérifie montant et devise, règle la préparation une seule fois et active l'abonnement préparé */
export async function settlePayment(admin: any, intent: PaymentIntent, paid: ConfirmedPayment, request: Request): Promise<SettleResult> {
  if (intent.status === 'paid') return { status: 'already' }
  if (intent.status !== 'pending') return { status: 'review', reason: intent.status }
  const paidCurrency = String(paid.currency ?? '').toUpperCase()
  const paidAmount = Number(paid.amount)
  // Montant et devise : ceux préparés par le serveur, jamais moins (tolérance d'un centime pour les arrondis)
  const problem = !(intent.billing_period in BILLING_PERIODS) ? 'invalid_period'
    : paidCurrency !== intent.currency ? 'currency_mismatch'
    : !Number.isFinite(paidAmount) || paidAmount < intent.amount_due - 0.01 ? 'amount_too_low' : null
  if (problem) {
    await admin.from('payment_intents').update({
      status: 'review', review_reason: problem, paid_amount: Number.isFinite(paidAmount) ? paidAmount : null, paid_currency: paidCurrency || null,
      gateway_tx_id: paid.gatewayTxId ?? null, settled_at: new Date().toISOString(),
    }).eq('id', intent.id).eq('status', 'pending')
    await writeAuditLog({
      action: 'billing.payment_review', shop_id: intent.shop_id, actor_id: intent.owner_id, target_id: intent.reference, target_type: `${intent.gateway}_payment`,
      metadata: { reason: problem, expected: intent.amount_due, expected_currency: intent.currency, paid: paidAmount, paid_currency: paidCurrency, plan: intent.plan, billing_period: intent.billing_period },
      ip: getClientIp(request),
    } as any)
    return { status: 'review', reason: problem }
  }

  // Règlement UNIQUE : deux retours simultanés de la passerelle n'activent qu'une fois
  const { data: claimed } = await admin.from('payment_intents').update({
    status: 'paid', paid_amount: paidAmount, paid_currency: paidCurrency, gateway_tx_id: paid.gatewayTxId ?? null, settled_at: new Date().toISOString(),
    ...(payerCountryOf(paid) ? { payer_country: payerCountryOf(paid) } : {}),
  }).eq('id', intent.id).eq('status', 'pending').select('id')
  if (!claimed?.length) return { status: 'already' }

  // Achat d'options en cours de période : ni formule ni nouvelle période, seulement les quantités ajoutées
  if (intent.kind === 'addon') return settleAddonPurchase(admin, intent, paidAmount, paidCurrency, paid, request)

  const days = getPeriodDays(intent.billing_period)
  const now = new Date()
  const plan_expires_at = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()

  // Abonnement de l'ENTREPRISE de la boutique payée (source de vérité depuis la migration 153)
  const account = await getAccountForShop(admin, intent.shop_id)
  if (account) {
    const { error: planError } = await setAccountPlan(admin, account, { plan: intent.plan, plan_expires_at, trial_ends_at: null })
    if (planError) console.error('[billing/settle] plan non enregistré', intent.shop_id, planError)
    // Options de la nouvelle période : celles comprises dans le prix préparé (retrait programmé appliqué)
    else await applyRenewalAddons(admin, account.entityId, Number(intent.addon_seats ?? 0), Number(intent.addon_shops ?? 0))
  } else console.error('[billing/settle] entreprise introuvable pour la boutique', intent.shop_id)

  const { data: shopRow } = await admin.from('shops').select('owner_id, agent_id, country').eq('id', intent.shop_id).maybeSingle()
  const ownerId = intent.owner_id ?? (shopRow as any)?.owner_id ?? null

  const { data: newSub } = await admin.from('subscriptions').insert({
    shop_id: intent.shop_id, plan: intent.plan, amount: paidAmount, billing_period: intent.billing_period,
    paystack_reference: intent.reference, starts_at: now.toISOString(), expires_at: plan_expires_at, status: 'active',
    auto_renew: intent.auto_renew, gateway: intent.gateway,
    gateway_authorization: intent.auto_renew && paid.authorization ? paid.authorization : null,
    gateway_email: paid.email ?? null, gateway_last4: paid.last4 ?? null,
  }).select('id').single()

  if (ownerId && newSub?.id) {
    // Parrainage (premier paiement du filleul) ; jamais bloquant
    await processReferralReward(admin, {
      ownerId, subscriptionId: newSub.id, shopCurrency: intent.currency, planId: intent.plan, amount: paidAmount,
      country: (shopRow as any)?.country ?? null,
    })
    // Crédit de parrainage réservé à la préparation : débité maintenant que le paiement est confirmé
    if (intent.credit_applied > 0) {
      await applyWalletCredit(admin, { userId: ownerId, intendedAmount: intent.credit_applied, currency: intent.currency, subscriptionId: newSub.id })
    }
  }

  // Commission de l'agent qui a amené la boutique : toutes les passerelles (avant : Paystack seulement)
  const agentId = (shopRow as any)?.agent_id
  if (agentId) {
    const { data: agentRow } = await admin.from('agents').select('commission_rate').eq('id', agentId).maybeSingle()
    if (agentRow) {
      await admin.from('agent_commissions').insert({
        agent_id: agentId, shop_id: intent.shop_id, subscription_amount: paidAmount,
        commission_amount: (paidAmount * Number((agentRow as any).commission_rate)) / 100,
        currency: intent.currency, plan_id: intent.plan, billing_period: intent.billing_period,
        paystack_reference: intent.reference, status: 'pending',
      })
    }
  }

  await writeAuditLog({
    action: 'billing.verify', shop_id: intent.shop_id, actor_id: ownerId, target_id: intent.reference, target_type: `${intent.gateway}_payment`,
    metadata: { plan_id: intent.plan, billing_period: intent.billing_period, amount: paidAmount, currency: intent.currency, credit_applied: intent.credit_applied, gateway_tx_id: paid.gatewayTxId ?? null, addon_seats: Number(intent.addon_seats ?? 0), addon_shops: Number(intent.addon_shops ?? 0) },
    ip: getClientIp(request),
  } as any)

  // Écart de pays (migration 208) : moyen de paiement ET demande depuis une zone plus chère que le pays tarifé. Jamais un
  // refus ni un changement de prix (diaspora, voyage) : une trace pour l'administration (page « Écarts de pays »).
  const payer = payerCountryOf(paid)
  if (intent.pricing_country && payer && intent.request_country
    && priceZone(payer) > priceZone(intent.pricing_country) && priceZone(intent.request_country) > priceZone(intent.pricing_country)) {
    await writeAuditLog({
      action: 'billing.country_review', shop_id: intent.shop_id, actor_id: ownerId, target_id: intent.reference, target_type: `${intent.gateway}_payment`,
      metadata: { pricing_country: intent.pricing_country, payer_country: payer, request_country: intent.request_country, plan: intent.plan, amount: paidAmount, currency: intent.currency },
      ip: getClientIp(request),
    } as any)
  }

  // Limites de la formule remises en ordre après chaque paiement (avant : Paystack seulement) ; jamais bloquant
  enforceShopPlanLimits(admin, intent.shop_id).catch(() => {})
  return { status: 'activated' }
}

/** Options achetées en cours de période (paiement déjà réglé une fois) : quantités ajoutées à l'entreprise, commission de
 *  l'agent, journal, limites remises en ordre (une personne ou une boutique en pause est réactivée). */
async function settleAddonPurchase(admin: any, intent: PaymentIntent, paidAmount: number, paidCurrency: string, paid: ConfirmedPayment, request: Request): Promise<SettleResult> {
  const account = await getAccountForShop(admin, intent.shop_id)
  const added = account ? await addPurchasedAddons(admin, account.entityId, account.plan, Number(intent.addon_seats ?? 0), Number(intent.addon_shops ?? 0)) : null
  const { data: shopRow } = await admin.from('shops').select('owner_id, agent_id').eq('id', intent.shop_id).maybeSingle()
  const ownerId = intent.owner_id ?? (shopRow as any)?.owner_id ?? null
  const agentId = (shopRow as any)?.agent_id
  if (agentId) {
    const { data: agentRow } = await admin.from('agents').select('commission_rate').eq('id', agentId).maybeSingle()
    if (agentRow) {
      await admin.from('agent_commissions').insert({
        agent_id: agentId, shop_id: intent.shop_id, subscription_amount: paidAmount,
        commission_amount: (paidAmount * Number((agentRow as any).commission_rate)) / 100,
        currency: intent.currency, plan_id: intent.plan, billing_period: intent.billing_period,
        paystack_reference: intent.reference, status: 'pending',
      })
    }
  }
  // Payé mais rien (ou pas tout) ajouté (plafond atteint entre-temps, entreprise introuvable) : à vérifier par l'équipe
  const short = !added || added.seats < Number(intent.addon_seats ?? 0) || added.shops < Number(intent.addon_shops ?? 0)
  await writeAuditLog({
    action: short ? 'billing.addon_review' : 'billing.addon_purchase', shop_id: intent.shop_id, actor_id: ownerId, target_id: intent.reference,
    target_type: `${intent.gateway}_payment`,
    metadata: { seats: Number(intent.addon_seats ?? 0), shops: Number(intent.addon_shops ?? 0), added, amount: paidAmount, currency: paidCurrency, period_end: intent.period_end ?? null, gateway_tx_id: paid.gatewayTxId ?? null },
    ip: getClientIp(request),
  } as any)
  enforceShopPlanLimits(admin, intent.shop_id).catch(() => {})
  return { status: 'activated' }
}

/** Pays du moyen de paiement, s'il est lisible (code ISO à 2 lettres) */
function payerCountryOf(paid: ConfirmedPayment): string | null {
  const c = String(paid.payerCountry || '').trim().toUpperCase()
  return /^[A-Z]{2}$/.test(c) ? c : null
}
