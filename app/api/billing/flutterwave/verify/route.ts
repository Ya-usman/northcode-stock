import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getPeriodDays, type BillingPeriod } from '@/lib/saas/countries'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { fetchWithTimeout } from '@/lib/api/fetch'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  // Flutterwave sends: status, tx_ref, transaction_id
  const status = searchParams.get('status')
  const tx_ref = searchParams.get('tx_ref')
  const transaction_id = searchParams.get('transaction_id')
  const locale = searchParams.get('locale') || 'en'

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    || `https://${process.env.VERCEL_URL}`
    || `${request.nextUrl.protocol}//${request.nextUrl.host}`

  if (status !== 'successful') {
    return NextResponse.redirect(new URL(`/${locale}/billing?error=payment_failed`, baseUrl))
  }

  if (!transaction_id) {
    return NextResponse.redirect(new URL(`/${locale}/billing?error=no_reference`, baseUrl))
  }

  try {
    const secretKey = process.env.FLUTTERWAVE_SECRET_KEY!

    // Verify transaction with Flutterwave
    const res = await fetchWithTimeout(`https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    })
    const data = await res.json()

    if (data.status !== 'success' || data.data?.status !== 'successful') {
      return NextResponse.redirect(new URL(`/${locale}/billing?error=payment_failed`, baseUrl))
    }

    const { shop_id, plan_id, billing_period = 'monthly', auto_renew = false } = data.data?.meta || {}

    if (!shop_id || !plan_id) {
      return NextResponse.redirect(new URL(`/${locale}/billing?error=invalid_meta`, baseUrl))
    }

    const supabase = await createAdminClient() as any

    // Idempotency: skip if this transaction was already processed
    const { data: existing } = await supabase
      .from('subscriptions').select('id').eq('paystack_reference', tx_ref ?? '').maybeSingle()
    if (existing) {
      return NextResponse.redirect(new URL(`/${locale}/billing?success=1`, baseUrl))
    }

    const days = getPeriodDays(billing_period as BillingPeriod)
    const plan_expires_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

    // Get owner_id to update profile (owner-level billing)
    const { data: shopRow } = await supabase.from('shops').select('owner_id').eq('id', shop_id).single()
    const owner_id = (shopRow as any)?.owner_id

    if (owner_id) {
      await supabase.from('profiles').update({
        plan: plan_id,
        plan_expires_at,
        trial_ends_at: null,
      } as any).eq('id', owner_id)

      await supabase.from('shops').update({
        plan: plan_id,
        plan_expires_at,
        trial_ends_at: null,
      } as any).eq('owner_id', owner_id).is('deleted_at', null)
    } else {
      await supabase.from('shops').update({
        plan: plan_id,
        plan_expires_at,
      } as any).eq('id', shop_id)
    }

    const cardToken = data.data?.card?.token ?? null
    const last4 = data.data?.card?.last_4digits ?? null

    await supabase.from('subscriptions').insert({
      shop_id,
      plan: plan_id,
      amount: data.data?.amount || 0,
      billing_period,
      paystack_reference: tx_ref,
      starts_at: new Date().toISOString(),
      expires_at: plan_expires_at,
      status: 'active',
      auto_renew: !!auto_renew,
      gateway: 'flutterwave',
      gateway_authorization: auto_renew && cardToken ? cardToken : null,
      gateway_email: data.data?.customer?.email ?? null,
      gateway_last4: last4,
    } as any)

    await writeAuditLog({
      action: 'billing.verify',
      shop_id,
      actor_id: owner_id ?? null,
      target_id: transaction_id,
      target_type: 'flutterwave_payment',
      metadata: { plan_id, billing_period, amount: data.data?.amount || 0 },
      ip: getClientIp(request),
    })

    return NextResponse.redirect(new URL(`/${locale}/billing?success=1`, baseUrl))
  } catch (err: any) {
    console.error('[billing/flutterwave/verify]', err)
    return NextResponse.redirect(new URL(`/${locale}/billing?error=server`, baseUrl))
  }
}
