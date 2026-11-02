import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { fetchWithTimeout } from '@/lib/api/fetch'
import { findPaymentIntent, settlePayment, recordUnmatchedPayment } from '@/lib/billing/payment-intents'

// Retour Wave (pays FCFA, Wave choisi). La session est relue auprès de Wave ; seule la préparation faite par le serveur
// (migration 204, retrouvée par la session gardée à la création ou par notre référence client_reference) dit quoi
// activer, et seulement si le montant et la devise confirmés correspondent (lib/billing/payment-intents).
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  // Wave sends: checkout_id on success_url
  const checkout_id = searchParams.get('checkout_id')
  const locale = searchParams.get('locale') || 'fr'

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    || `https://${process.env.VERCEL_URL}`
    || `${request.nextUrl.protocol}//${request.nextUrl.host}`
  const go = (q: string) => NextResponse.redirect(new URL(`/${locale}/billing?${q}`, baseUrl))

  if (!checkout_id) return go('error=no_reference')

  try {
    const waveKey = process.env.WAVE_API_KEY!
    const res = await fetchWithTimeout(`https://api.wave.com/v1/checkout/sessions/${encodeURIComponent(checkout_id)}`, {
      headers: { Authorization: `Bearer ${waveKey}` },
    })
    const data = await res.json()
    if (data.payment_status !== 'succeeded') return go('error=payment_failed')

    const admin = await createAdminClient() as any
    const intent = await findPaymentIntent(admin, 'wave', { gatewayReference: data.id || checkout_id, reference: data.client_reference })
    if (!intent) {
      await recordUnmatchedPayment('wave', { reference: data.client_reference || checkout_id, amount: data.amount, currency: data.currency }, request)
      return go('error=payment_review')
    }
    const result = await settlePayment(admin, intent, {
      amount: Number(data.amount), currency: data.currency, gatewayTxId: String(data.transaction_id || data.id || checkout_id),
    }, request)
    return result.status === 'review' ? go('error=payment_review') : go('success=1')
  } catch (err: any) {
    console.error('[billing/wave/verify]', err)
    return go('error=server')
  }
}
