import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { fetchWithTimeout } from '@/lib/api/fetch'
import { findPaymentIntent, settlePayment, recordUnmatchedPayment } from '@/lib/billing/payment-intents'

// Retour NotchPay (Cameroun). La transaction est relue auprès de NotchPay ; seule la préparation faite par le serveur
// (migration 204, retrouvée par la référence NotchPay gardée à la création ou par notre référence marchand) dit quoi
// activer, et seulement si le montant et la devise confirmés correspondent (lib/billing/payment-intents).
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const reference = searchParams.get('reference') || searchParams.get('trxref')
  const locale = searchParams.get('locale') || 'en'

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL}`
  const go = (q: string) => NextResponse.redirect(new URL(`/${locale}/billing?${q}`, baseUrl))

  if (!reference) return go('error=no_reference')

  try {
    // Verification requires the hash key (secret), not the public key
    const hashKey = process.env.NOTCHPAY_HASH_KEY || process.env.NOTCHPAY_PUBLIC_KEY!
    const res = await fetchWithTimeout(`https://api.notchpay.co/payments/${encodeURIComponent(reference)}`, {
      headers: { Authorization: hashKey, Accept: 'application/json' },
    })
    const data = await res.json()

    // NotchPay returns status 'complete' for successful payments
    const tx = data.transaction || data.payment || {}
    if (tx.status !== 'complete' && tx.status !== 'success') return go('error=payment_failed')

    const admin = await createAdminClient() as any
    const intent = await findPaymentIntent(admin, 'notchpay', { gatewayReference: tx.reference || reference, reference: tx.merchant_reference })
    if (!intent) {
      await recordUnmatchedPayment('notchpay', { reference: tx.reference || reference, amount: tx.amount, currency: tx.currency }, request)
      return go('error=payment_review')
    }
    const result = await settlePayment(admin, intent, {
      amount: Number(tx.amount), currency: tx.currency, gatewayTxId: String(tx.reference || reference), email: tx.customer?.email ?? null,
    }, request)
    return result.status === 'review' ? go('error=payment_review') : go('success=1')
  } catch (err: any) {
    console.error('[billing/notchpay/verify]', err)
    return go('error=server')
  }
}
