import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { checkShopRole } from '@/lib/api/shop-auth'
import { checkRateLimit } from '@/lib/rate-limit'
import { validateBody, uuid, email as emailSchema } from '@/lib/api/validate'
import { getApiTranslator } from '@/lib/api/i18n'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getCountry, getBillingCurrency } from '@/lib/saas/countries'
import { getAccountForShop, getEntityShopIds } from '@/lib/saas/entity'
import { getPricingCountry, requestCountry } from '@/lib/saas/pricing-country'
import { getLegacyTerms, monthlyPriceFor } from '@/lib/saas/legacy-terms'
import {
  MAX_ADDON_SEATS, MIN_PRORATA_DAYS, addonsMonthly, currentBillingPeriod, getEntityAddons, isPaidPlan, maxShopAddons,
  periodPriceWithAddons, prorataQuote, renewalAddons, upgradeAdvice,
} from '@/lib/saas/addons'
import { createPaymentIntent, newPaymentReference, type Gateway } from '@/lib/billing/payment-intents'
import { startGatewayPayment } from '@/lib/billing/start-payment'

// Options payantes (tarification du 3 nov. 2026, étape 2 ; règle : lib/saas/addons, migration 210).
// Propriétaire de l'entreprise seulement. Prix, prorata et plafonds calculés ICI, jamais par l'appareil.
//   GET  ?shop_id=…                                   état, prix, devis du prorata, renouvellement, conseil
//   POST { action: 'buy', shop_id, seats, shops, email, locale?, payment_method? }   achat au prorata → lien de paiement
//   POST { action: 'renewal', shop_id, seats, shops } quantités reconduites (retrait programmé, ou retrait annulé)

async function ownerContext(request: Request, shopId: string) {
  const t = getApiTranslator(request)
  const userClient = await createClient() as any
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: t('not_authenticated') }, { status: 401 }) }
  const admin = await createAdminClient() as any
  const account = await getAccountForShop(admin, shopId)
  const role = await checkShopRole(userClient, user.id, shopId)
  if (!account || !(account.ownerId === user.id || role === 'owner')) return { error: NextResponse.json({ error: t('permission_denied') }, { status: 403 }) }
  const pricing = await getPricingCountry(admin, account)
  const country = getCountry(pricing.country)
  const currency = getBillingCurrency(country)
  const [addons, shopIds, terms] = await Promise.all([getEntityAddons(admin, account.entityId), getEntityShopIds(admin, account, { includeSuspended: true }), getLegacyTerms(admin, account.entityId)])
  const period = await currentBillingPeriod(admin, shopIds)
  return { t, user, admin, account, pricing, country, currency, addons, period, terms }
}

export async function GET(request: Request) {
  const shopId = new URL(request.url).searchParams.get('shop_id') || ''
  if (!/^[0-9a-f-]{36}$/i.test(shopId)) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const c = await ownerContext(request, shopId)
  if ('error' in c) return c.error
  const { account, country, currency, addons, period, terms } = c
  const plan = account.plan
  const active = isPaidPlan(plan) && !!account.plan_expires_at && new Date(account.plan_expires_at) > new Date()
  const prices = country.addons
  const planPrices = { starter: country.prices.starter, pro: country.prices.pro, business: country.prices.business }
  const quote = (seats: number, shops: number) => active ? prorataQuote({ prices, seats, shops, planExpiresAt: account.plan_expires_at, billingPeriod: period, currency }) : null
  const renew = isPaidPlan(plan) ? renewalAddons(addons, plan) : { seats: 0, shops: 0 }
  const planMonthly = isPaidPlan(plan) ? monthlyPriceFor(country.prices[plan], plan, currency, terms, account).price : 0
  return NextResponse.json({
    plan, active, plan_expires_at: account.plan_expires_at, billing_period: period, currency, prices,
    addons: { seats: addons.seats, shops: addons.shops, seats_renew: renew.seats, shops_renew: renew.shops },
    max: { seats: MAX_ADDON_SEATS, shops: maxShopAddons(plan) },
    quote: { seat: quote(1, 0), shop: maxShopAddons(plan) > addons.shops ? quote(0, 1) : null },
    min_days: MIN_PRORATA_DAYS,
    renewal: isPaidPlan(plan) ? {
      monthly_addons: addonsMonthly(prices, renew.seats, renew.shops),
      period_total: periodPriceWithAddons(planMonthly, prices, renew.seats, renew.shops, period),
    } : null,
    advice: isPaidPlan(plan) ? upgradeAdvice(plan, planPrices, prices, addons.seats, addons.shops) : null,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

const buySchema = z.object({
  action: z.literal('buy'), shop_id: uuid, email: emailSchema,
  seats: z.number().int().min(0).max(MAX_ADDON_SEATS), shops: z.number().int().min(0).max(2),
  locale: z.string().max(5).optional(), payment_method: z.string().max(50).default(''),
})
const renewalSchema = z.object({
  action: z.literal('renewal'), shop_id: uuid,
  seats: z.number().int().min(0).max(MAX_ADDON_SEATS), shops: z.number().int().min(0).max(2),
})

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, 'billing')
  if (limited) return limited
  const body = await request.json().catch(() => ({}))
  if (body?.action === 'renewal') {
    const v = validateBody(renewalSchema, body)
    if ('error' in v) return v.error
    const c = await ownerContext(request, v.data.shop_id)
    if ('error' in c) return c.error
    const { t, admin, account, addons, user } = c
    // Retrait seulement (ou retour à la quantité payée) : jamais plus que ce qui est payé — acheter, c'est « buy »
    if (v.data.seats > addons.seats || v.data.shops > addons.shops) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    const { error } = await admin.from('entities').update({
      addon_seats_renew: v.data.seats === addons.seats ? null : v.data.seats,
      addon_shops_renew: v.data.shops === addons.shops ? null : v.data.shops,
    }).eq('id', account.entityId)
    if (error) return NextResponse.json({ error: t('invalid_data') }, { status: 500 })
    await writeAuditLog({
      action: 'billing.addon_renewal', shop_id: v.data.shop_id, actor_id: user.id, target_id: account.entityId, target_type: 'entity',
      metadata: { seats_paid: addons.seats, shops_paid: addons.shops, seats_renew: v.data.seats, shops_renew: v.data.shops, until: account.plan_expires_at },
      ip: getClientIp(request),
    } as any)
    return NextResponse.json({ ok: true })
  }

  const v = validateBody(buySchema, body)
  if ('error' in v) return v.error
  const { shop_id, seats, shops, email, locale, payment_method } = v.data
  const c = await ownerContext(request, shop_id)
  if ('error' in c) return c.error
  const { t, admin, account, country, currency, addons, period, pricing } = c
  if (seats + shops === 0) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
  // Formule payée en cours seulement (l'essai a déjà les limites de Pro)
  if (!isPaidPlan(account.plan) || !account.plan_expires_at || new Date(account.plan_expires_at) <= new Date())
    return NextResponse.json({ error: t('addon_paid_plan_required'), code: 'addon_paid_plan_required' }, { status: 409 })
  if (addons.seats + seats > MAX_ADDON_SEATS) return NextResponse.json({ error: t('addon_seat_max', { max: MAX_ADDON_SEATS }), code: 'addon_seat_max' }, { status: 400 })
  if (addons.shops + shops > maxShopAddons(account.plan)) return NextResponse.json({ error: t('addon_shop_max'), code: 'addon_shop_max' }, { status: 400 })
  const quote = prorataQuote({ prices: country.addons, seats, shops, planExpiresAt: account.plan_expires_at, billingPeriod: period, currency })
  if (!quote) return NextResponse.json({ error: t('addon_too_close_to_renewal', { days: MIN_PRORATA_DAYS }), code: 'addon_too_close_to_renewal' }, { status: 409 })

  const gateway: Gateway = country.gateway === 'flutterwave' && payment_method === 'wave' ? 'wave' : country.gateway as Gateway
  if (gateway === 'stripe') return NextResponse.json({ error: 'stripe_coming_soon' }, { status: 400 })
  const reference = newPaymentReference(shop_id)
  const prepared = await createPaymentIntent(admin, {
    reference, gateway, entity_id: account.entityId, shop_id, owner_id: account.ownerId, plan: account.plan as any, billing_period: period,
    currency, amount: quote.amount, credit_applied: 0, amount_due: quote.amount, auto_renew: false,
    request_country: requestCountry(request), pricing_reason: pricing.reason, pricing_country: pricing.country,
    kind: 'addon', addon_seats: seats, addon_shops: shops, period_end: quote.until,
  })
  if (!prepared.ok) {
    console.error('[billing/addons] préparation du paiement impossible', prepared.error)
    return NextResponse.json({ error: t('payment_gateway_error') }, { status: 500 })
  }
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL}`
  const label = [seats ? (seats === 1 ? '1 employé' : `${seats} employés`) : '', shops ? (shops === 1 ? '1 boutique' : `${shops} boutiques`) : ''].filter(Boolean).join(' + ')
  return startGatewayPayment({
    supabase: admin, t, gatewayOf: country.gateway, countryCode: country.code, paymentMethod: payment_method ?? '', reference, amountDue: quote.amount,
    currency, email, locale, baseUrl,
    meta: { shop_id, kind: 'addon', seats, shops, locale, until: quote.until },
    descriptions: { notchpay: `StockShop options : ${label}`, flutterwave: `Options ${label}` },
  })
}
