import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { checkShopRole } from '@/lib/api/shop-auth'
import { getPeriodDays, OFFERED_PERIODS, type BillingPeriod } from '@/lib/saas/countries'
import { checkRateLimit } from '@/lib/rate-limit'
import { validateBody, uuid, email as emailSchema, billingPeriodEnum, planEnum } from '@/lib/api/validate'
import { getApiTranslator } from '@/lib/api/i18n'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { enforceShopPlanLimits } from '@/lib/saas/enforce-limits'
import { createPaymentIntent, newPaymentReference, type Gateway } from '@/lib/billing/payment-intents'
import { startGatewayPayment } from '@/lib/billing/start-payment'
import { applyRenewalAddons } from '@/lib/saas/addons'
import { computePlanCharge } from '@/lib/billing/plan-charge'
import { getEntityCustom } from '@/lib/saas/custom-plan'
import { previewWalletCredit, applyWalletCredit } from '@/lib/referrals/apply-credit'
import { getAccountForShop, setAccountPlan } from '@/lib/saas/entity'
import { requestCountry } from '@/lib/saas/pricing-country'
import { z } from 'zod'

const subscribeSchema = z.object({
  plan_id: planEnum,
  shop_id: uuid,
  email: emailSchema,
  locale: z.string().max(5).optional(),
  billing_period: billingPeriodEnum.default('monthly'),
  payment_method: z.string().max(50).default(''),
  auto_renew: z.boolean().default(false),
  use_credit: z.boolean().default(false),
})

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, 'billing')
  if (limited) return limited

  const t = getApiTranslator(request)
  try {
    const body = await request.json()
    const validated = validateBody(subscribeSchema, body)
    if ('error' in validated) return validated.error
    const { plan_id, shop_id, email, locale, billing_period, payment_method, auto_renew, use_credit } = validated.data

    const period = billing_period as BillingPeriod
    // Durées proposées seulement (mensuel, 6 mois, 1 an) : le trimestre n'est plus vendu (3 nov. 2026)
    if (!OFFERED_PERIODS.includes(period)) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })

    // Seul le propriétaire connecté de la boutique paie pour elle (3 nov. 2026). Avant : aucun contrôle de l'appelant,
    // n'importe qui pouvait créer un paiement, ou dépenser le crédit de parrainage d'un autre propriétaire.
    const userClient = await createClient() as any
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const supabase = await createAdminClient() as any
    const callerAccount = await getAccountForShop(supabase, shop_id)
    const callerRole = await checkShopRole(userClient, user.id, shop_id)
    if (!(callerAccount?.ownerId === user.id || callerRole === 'owner')) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }
    // Offre sur mesure en cours (migration 211) : pas de formule normale par-dessus (ses limites tomberaient et les
    // boutiques au-delà de 3 seraient mises en pause) ; on passe par l'équipe pour la modifier
    const callerCustom = callerAccount ? await getEntityCustom(supabase, callerAccount.entityId) : null
    if (callerCustom?.quoteId && callerAccount?.plan_expires_at && new Date(callerAccount.plan_expires_at) > new Date())
      return NextResponse.json({ error: t('custom_plan_active'), code: 'custom_plan_active' }, { status: 409 })
    const { data: shopData } = await supabase
      .from('shops').select('country, billing_country, currency, owner_id').eq('id', shop_id).single()

    // billing_country (figé à l'inscription) fait foi pour le montant/la devise/la
    // passerelle — pas `country` (modifiable par l'owner dans Paramètres), sinon le
    // prix affiché sur la page billing (qui utilise déjà billing_country) diverge
    // silencieusement du montant réellement facturé ici.
    // Pays de facturation de l'ENTREPRISE (migration 153), sinon celui de la boutique
    const account = await getAccountForShop(supabase, shop_id)
    // Montant : RÈGLE UNIQUE avec le renouvellement automatique (lib/billing/plan-charge) — pays de TARIFICATION
    // (migration 208, jamais choisi par l'appareil), ancien prix garanti s'il est moins cher (205), options reconduites
    // (210), même remise de durée. Devise de FACTURATION (EUR pour l'UE), jamais country.currency.
    const charge = await computePlanCharge(supabase, account, plan_id as 'starter' | 'pro' | 'business', period, (shopData as any)?.billing_country || (shopData as any)?.country)
    if (!charge) {
      return NextResponse.json({ error: t('invalid_plan_for_country') }, { status: 400 })
    }
    const { country, pricing, renew, amount } = charge
    const billingCurrency = charge.currency
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL}`

    // ── Crédit de parrainage ────────────────────────────────────────────────
    // Réduit ce qui est envoyé à la passerelle (jamais le prix affiché
    // avant) — voir lib/referrals/apply-credit.ts. Le débit réel du wallet
    // n'a lieu qu'à la confirmation du paiement (ou immédiatement ici si le
    // crédit couvre 100% du prix, auquel cas aucune passerelle n'est appelée).
    let amountDue = amount
    let creditApplied = 0
    if (use_credit) {
      const { data: ownerMember } = await supabase
        .from('shop_members').select('user_id').eq('shop_id', shop_id).eq('role', 'owner').eq('is_active', true).maybeSingle()
      const owner_id = ownerMember?.user_id ?? (shopData as any)?.owner_id
      if (owner_id) {
        const preview = await previewWalletCredit(supabase, owner_id, amount, billingCurrency)
        creditApplied = preview.creditApplied
        amountDue = preview.amountDue

        if (creditApplied > 0 && amountDue === 0) {
          // 100% couvert par le crédit — aucune passerelle de paiement n'est
          // jamais appelée. Réplique ce que fait normalement chaque route
          // billing/*/verify après confirmation d'un paiement.
          const days = getPeriodDays(period)
          const plan_expires_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

          // Abonnement de l'entreprise (source de vérité, migration 153)
          if (account) {
            await setAccountPlan(supabase, account, { plan: plan_id, plan_expires_at, trial_ends_at: null })
            await applyRenewalAddons(supabase, account.entityId, renew.seats, renew.shops)
          }

          const { data: newSub } = await supabase.from('subscriptions').insert({
            shop_id, plan: plan_id, amount: 0, billing_period: period,
            paystack_reference: `CREDIT-${shop_id.slice(0, 8)}-${Date.now()}`,
            starts_at: new Date().toISOString(), expires_at: plan_expires_at,
            status: 'active', auto_renew: false, gateway: 'wallet_credit',
          } as any).select('id').single()

          if (newSub?.id) {
            await applyWalletCredit(supabase, {
              userId: owner_id, intendedAmount: creditApplied,
              currency: billingCurrency, subscriptionId: newSub.id,
            })
            await writeAuditLog({
              action: 'billing.verify',
              shop_id, actor_id: owner_id, target_id: newSub.id, target_type: 'subscription',
              metadata: { plan_id, billing_period: period, amount: 0, credit_applied: creditApplied, fully_covered: true },
              ip: getClientIp(request),
            })
            // Pas d'appel à processReferralReward ici : aucun paiement réel
            // (montant facturé = 0) ne doit consommer le "premier paiement"
            // du filleul — voir lib/referrals/process-reward.ts.
            enforceShopPlanLimits(supabase, shop_id).catch(() => {})
          }

          return NextResponse.json({ fully_paid: true, credit_applied: creditApplied })
        }
      }
    }

    // ── Paiement PRÉPARÉ par le serveur (migration 204) ─────────────────────
    // Formule, durée, devise et montant attendu enregistrés ici ; la confirmation (routes */verify) ne croit plus les
    // informations jointes au paiement et n'active que ce qui a été préparé, au montant prévu.
    const gateway: Gateway = country.gateway === 'flutterwave' && payment_method === 'wave' ? 'wave' : country.gateway
    const reference = newPaymentReference(shop_id)
    if (gateway !== 'stripe') {
      const prepared = await createPaymentIntent(supabase, {
        reference, gateway, entity_id: account?.entityId ?? null, shop_id, owner_id: (shopData as any)?.owner_id ?? account?.ownerId ?? null,
        plan: plan_id as any, billing_period: period, currency: billingCurrency, amount, credit_applied: creditApplied, amount_due: amountDue,
        auto_renew: !!auto_renew,
        request_country: requestCountry(request), pricing_reason: pricing.reason, pricing_country: pricing.country,
        kind: 'plan', addon_seats: renew.seats, addon_shops: renew.shops,
      })
      if (!prepared.ok) {
        console.error('[billing/subscribe] préparation du paiement impossible', prepared.error)
        return NextResponse.json({ error: t('payment_gateway_error') }, { status: 500 })
      }
    }
    return startGatewayPayment({
      supabase, t, gatewayOf: country.gateway, countryCode: country.code, paymentMethod: payment_method ?? '', reference, amountDue,
      currency: billingCurrency, email, locale, baseUrl,
      meta: { shop_id, plan_id, locale, billing_period: period, auto_renew, credit_amount: creditApplied },
      descriptions: { notchpay: `Abonnement StockShop Plan ${plan_id}`, flutterwave: `Abonnement Plan ${plan_id}` },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
