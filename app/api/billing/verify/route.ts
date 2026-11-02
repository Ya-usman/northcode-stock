import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { fetchWithTimeout } from '@/lib/api/fetch'
import { findPaymentIntent, settlePayment, recordUnmatchedPayment } from '@/lib/billing/payment-intents'

// Retour Paystack (Nigeria). La transaction est relue auprès de Paystack ; seule la préparation faite par le serveur
// (migration 204, retrouvée par notre référence) dit quoi activer, et seulement si le montant et la devise confirmés
// correspondent (lib/billing/payment-intents). Les metadata jointes au paiement sont ignorées.

// inline=1 → appelé depuis le callback PaystackPop (client-side fetch) → retourne JSON
// inline absent → appelé depuis le redirect navigateur Paystack → retourne redirect
function reply(inline: boolean, locale: string, baseUrl: string, ok: true): NextResponse
function reply(inline: boolean, locale: string, baseUrl: string, ok: false, error: string): NextResponse
function reply(inline: boolean, locale: string, baseUrl: string, ok: boolean, error?: string): NextResponse {
  if (inline) {
    return ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ ok: false, error }, { status: 400 })
  }
  return ok
    ? NextResponse.redirect(new URL(`/${locale}/billing?success=1`, baseUrl))
    : NextResponse.redirect(new URL(`/${locale}/billing?error=${error}`, baseUrl))
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const reference = searchParams.get('reference') || searchParams.get('trxref')
  const locale = searchParams.get('locale') || 'en'
  const inline = searchParams.get('inline') === '1'

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    || `https://${process.env.VERCEL_URL}`
    || `${request.nextUrl.protocol}//${request.nextUrl.host}`

  if (!reference) return reply(inline, locale, baseUrl, false, 'no_reference')

  try {
    const secret = process.env.PAYSTACK_SECRET_KEY!
    const res = await fetchWithTimeout(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secret}` },
    })
    const data = await res.json()

    // Accept only confirmed payments. Bank transfers fired with 'pending' status
    // may never complete (cancelled/rejected transfer) — no rollback exists if
    // we activate the plan immediately.
    if (!data.status || data.data?.status !== 'success') return reply(inline, locale, baseUrl, false, 'payment_failed')

    const tx = data.data
    const admin = await createAdminClient() as any
    const intent = await findPaymentIntent(admin, 'paystack', { reference: tx.reference })
    if (!intent) {
      await recordUnmatchedPayment('paystack', { reference: tx.reference, amount: Number(tx.amount) / 100, currency: tx.currency }, request)
      return reply(inline, locale, baseUrl, false, 'payment_review')
    }
    const auth = tx.authorization
    const result = await settlePayment(admin, intent, {
      amount: Number(tx.amount) / 100, currency: tx.currency, gatewayTxId: String(tx.id ?? tx.reference),
      authorization: auth?.reusable === true ? auth.authorization_code : null, email: tx.customer?.email ?? null, last4: auth?.last4 ?? null,
    }, request)
    return result.status === 'review' ? reply(inline, locale, baseUrl, false, 'payment_review') : reply(inline, locale, baseUrl, true)
  } catch (err: any) {
    console.error('[billing/verify]', err)
    return reply(inline, locale, baseUrl, false, 'server')
  }
}
