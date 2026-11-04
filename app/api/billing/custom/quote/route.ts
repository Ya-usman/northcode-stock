import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { validateBody, email as emailSchema } from '@/lib/api/validate'
import { getApiTranslator } from '@/lib/api/i18n'
import { getCountry } from '@/lib/saas/countries'
import { getEntityShopIds } from '@/lib/saas/entity'
import { quotePayable, quoteState, type QuoteRow } from '@/lib/saas/custom-plan'
import { requestCountry } from '@/lib/saas/pricing-country'
import { createPaymentIntent, newPaymentReference, type Gateway } from '@/lib/billing/payment-intents'
import { startGatewayPayment } from '@/lib/billing/start-payment'

// Page du devis (lien envoyé par e-mail) et paiement — propriétaire de l'entreprise du devis seulement.
//   GET  ?token=…                                    le devis, son état et s'il peut être payé
//   POST { token, email, locale?, payment_method? }  paiement : montant LU DANS LE DEVIS (jamais envoyé par l'écran),
//                                                     paiement préparé (kind 'custom'), puis lien de la passerelle
// Premier paiement : devis envoyé et encore valable ; ensuite, renouvellement au même prix tant qu'il est garanti.

const COLUMNS = 'id, entity_id, status, req_shops, req_seats, req_period, currency, pricing_country, monthly_price, billing_period, period_total, limit_shops, limit_seats, client_note, valid_until, price_until, token, created_at, quoted_at, paid_at'

async function load(request: Request, token: string) {
  const t = getApiTranslator(request)
  if (!/^[A-Za-z0-9_-]{24,80}$/.test(token)) return { error: NextResponse.json({ error: t('custom_quote_not_found') }, { status: 404 }) }
  const userClient = await createClient() as any
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: t('not_authenticated') }, { status: 401 }) }
  const admin = await createAdminClient() as any
  const { data: q } = await admin.from('custom_quotes').select(COLUMNS).eq('token', token).maybeSingle()
  if (!q) return { error: NextResponse.json({ error: t('custom_quote_not_found') }, { status: 404 }) }
  const { data: ent } = await admin.from('entities').select('id, name, owner_user_id, custom_quote_id, billing_country').eq('id', q.entity_id).maybeSingle()
  // Même réponse qu'un lien inconnu pour un autre compte : rien n'indique que le devis existe
  if (!ent || ent.owner_user_id !== user.id) return { error: NextResponse.json({ error: t('custom_quote_not_found') }, { status: 404 }) }
  return { t, user, admin, q: q as QuoteRow & Record<string, any>, ent }
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token') || ''
  const c = await load(request, token)
  if ('error' in c) return c.error
  const { q, ent } = c
  const payable = quotePayable(q, ent.custom_quote_id)
  return NextResponse.json({
    quote: { ...q, entity_id: undefined, state: quoteState(q) }, entity: { name: ent.name }, payable,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

const paySchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{24,80}$/), email: emailSchema,
  locale: z.string().max(5).optional(), payment_method: z.string().max(50).default(''),
})

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, 'billing')
  if (limited) return limited
  const v = validateBody(paySchema, await request.json().catch(() => ({})))
  if ('error' in v) return v.error
  const c = await load(request, v.data.token)
  if ('error' in c) return c.error
  const { t, admin, q, ent } = c
  const payable = quotePayable(q, ent.custom_quote_id)
  if (!payable) return NextResponse.json({ error: t(quoteState(q) === 'expired' ? 'custom_quote_expired' : 'custom_quote_not_payable'), code: 'custom_quote_not_payable' }, { status: 409 })

  // Passerelle du pays du devis (celui de tarification au moment du devis)
  const country = getCountry(q.pricing_country || ent.billing_country)
  const gateway: Gateway = country.gateway === 'flutterwave' && v.data.payment_method === 'wave' ? 'wave' : country.gateway as Gateway
  if (gateway === 'stripe') return NextResponse.json({ error: 'stripe_coming_soon' }, { status: 400 })
  const shopIds = await getEntityShopIds(admin, { entityId: ent.id }, { includeSuspended: true })
  if (!shopIds.length) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
  const reference = newPaymentReference(shopIds[0])
  const amount = Number(q.period_total)
  const prepared = await createPaymentIntent(admin, {
    reference, gateway, entity_id: ent.id, shop_id: shopIds[0], owner_id: c.user.id, plan: 'business', billing_period: q.billing_period!,
    currency: q.currency!, amount, credit_applied: 0, amount_due: amount, auto_renew: false,
    request_country: requestCountry(request), pricing_reason: 'override', pricing_country: q.pricing_country || null,
    kind: 'custom', quote_id: q.id, addon_seats: 0, addon_shops: 0,
  })
  if (!prepared.ok) {
    console.error('[billing/custom/quote] préparation du paiement impossible', prepared.error)
    return NextResponse.json({ error: t('payment_gateway_error') }, { status: 500 })
  }
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL}`
  return startGatewayPayment({
    supabase: admin, t, gatewayOf: country.gateway, countryCode: country.code, paymentMethod: v.data.payment_method ?? '', reference, amountDue: amount,
    currency: q.currency!, email: v.data.email, locale: v.data.locale, baseUrl,
    meta: { kind: 'custom', quote: q.id, shops: q.limit_shops, seats: q.limit_seats, renewal: payable === 'renewal' },
    descriptions: { notchpay: `StockShop sur mesure : ${q.limit_shops} boutiques`, flutterwave: `Offre sur mesure (${q.limit_shops} boutiques)` },
  })
}
