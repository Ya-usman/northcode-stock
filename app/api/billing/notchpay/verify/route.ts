import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getPeriodDays, type BillingPeriod } from '@/lib/saas/countries'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { fetchWithTimeout } from '@/lib/api/fetch'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const reference = searchParams.get('reference') || searchParams.get('trxref')
  const locale = searchParams.get('locale') || 'en'

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL}`

  if (!reference) {
    return NextResponse.redirect(new URL(`/${locale}/billing?error=no_reference`, baseUrl))
  }

  try {
    // Verification requires the hash key (secret), not the public key
    const hashKey = process.env.NOTCHPAY_HASH_KEY || process.env.NOTCHPAY_PUBLIC_KEY!

    const res = await fetchWithTimeout(`https://api.notchpay.co/payments/${reference}`, {
      headers: {
        Authorization: hashKey,
        Accept: 'application/json',
      },
    })
    const data = await res.json()

    // NotchPay returns status 'complete' for successful payments
    const txStatus = data.transaction?.status || data.payment?.status
    if (txStatus !== 'complete' && txStatus !== 'success') {
      return NextResponse.redirect(new URL(`/${locale}/billing?error=payment_failed`, baseUrl))
    }

    const meta = data.transaction?.meta || data.payment?.meta || {}
    const { shop_id, plan_id, billing_period = 'monthly', auto_renew = false } = meta

    if (!shop_id || !plan_id) {
      return NextResponse.redirect(new URL(`/${locale}/billing?error=invalid_meta`, baseUrl))
    }

    const supabase = await createAdminClient() as any

    // Idempotency: skip if this reference was already processed
    const { data: existing } = await supabase
      .from('subscriptions').select('id').eq('paystack_reference', reference).maybeSingle()
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

    const amount = data.transaction?.amount || data.payment?.amount || 0

    await supabase.from('subscriptions').insert({
      shop_id,
      plan: plan_id,
      amount,
      billing_period,
      paystack_reference: reference,
      starts_at: new Date().toISOString(),
      expires_at: plan_expires_at,
      status: 'active',
      auto_renew: !!auto_renew,
      gateway: 'notchpay',
      gateway_email: data.transaction?.customer?.email ?? data.payment?.customer?.email ?? null,
    } as any)

    await writeAuditLog({
      action: 'billing.verify',
      shop_id,
      actor_id: owner_id ?? null,
      target_id: reference,
      target_type: 'notchpay_payment',
      metadata: { plan_id, billing_period, amount },
      ip: getClientIp(request),
    })

    return NextResponse.redirect(new URL(`/${locale}/billing?success=1`, baseUrl))
  } catch (err: any) {
    console.error('[billing/notchpay/verify]', err)
    return NextResponse.redirect(new URL(`/${locale}/billing?error=server`, baseUrl))
  }
}
