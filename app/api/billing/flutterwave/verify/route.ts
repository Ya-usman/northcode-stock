import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { fetchWithTimeout } from '@/lib/api/fetch'
import { findPaymentIntent, settlePayment, recordUnmatchedPayment } from '@/lib/billing/payment-intents'

// Retour Flutterwave (pays FCFA hors Cameroun). La transaction est relue auprès de Flutterwave ; seule la préparation
// faite par le serveur (migration 204, retrouvée par notre référence tx_ref) dit quoi activer, et seulement si le montant
// et la devise confirmés correspondent (lib/billing/payment-intents). Les informations jointes au paiement sont ignorées.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  // Flutterwave sends: status, tx_ref, transaction_id
  const status = searchParams.get('status')
  const transaction_id = searchParams.get('transaction_id')
  const locale = searchParams.get('locale') || 'en'

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    || `https://${process.env.VERCEL_URL}`
    || `${request.nextUrl.protocol}//${request.nextUrl.host}`
  const go = (q: string) => NextResponse.redirect(new URL(`/${locale}/billing?${q}`, baseUrl))

  if (status !== 'successful') return go('error=payment_failed')
  if (!transaction_id) return go('error=no_reference')

  try {
    const secretKey = process.env.FLUTTERWAVE_SECRET_KEY!
    // La transaction relue auprès de Flutterwave fait foi (jamais les paramètres de l'adresse de retour)
    const res = await fetchWithTimeout(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transaction_id)}/verify`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    })
    const data = await res.json()
    if (data.status !== 'success' || data.data?.status !== 'successful') return go('error=payment_failed')

    const tx = data.data
    const admin = await createAdminClient() as any
    const intent = await findPaymentIntent(admin, 'flutterwave', { reference: tx.tx_ref })
    if (!intent) {
      await recordUnmatchedPayment('flutterwave', { reference: tx.tx_ref, amount: tx.amount, currency: tx.currency }, request)
      return go('error=payment_review')
    }
    const result = await settlePayment(admin, intent, {
      amount: Number(tx.amount), currency: tx.currency, gatewayTxId: String(tx.id ?? transaction_id),
      authorization: tx.card?.token ?? null, email: tx.customer?.email ?? null, last4: tx.card?.last_4digits ?? null,
      payerCountry: typeof tx.card?.country === 'string' ? tx.card.country.trim().slice(-2) : null,
    }, request)
    return result.status === 'review' ? go('error=payment_review') : go('success=1')
  } catch (err: any) {
    console.error('[billing/flutterwave/verify]', err)
    return go('error=server')
  }
}
