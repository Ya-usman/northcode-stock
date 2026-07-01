import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getPeriodDays, type BillingPeriod } from '@/lib/saas/countries'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { fetchWithTimeout } from '@/lib/api/fetch'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  // Wave sends: checkout_id on success_url
  const checkout_id = searchParams.get('checkout_id')
  const locale = searchParams.get('locale') || 'fr'

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    || `https://${process.env.VERCEL_URL}`
    || `${request.nextUrl.protocol}//${request.nextUrl.host}`

  if (!checkout_id) {
    return NextResponse.redirect(new URL(`/${locale}/billing?error=no_reference`, baseUrl))
  }

  try {
    const waveKey = process.env.WAVE_API_KEY!

    const res = await fetchWithTimeout(`https://api.wave.com/v1/checkout/sessions/${checkout_id}`, {
      headers: { Authorization: `Bearer ${waveKey}` },
    })
    const data = await res.json()

    if (data.payment_status !== 'succeeded') {
      return NextResponse.redirect(new URL(`/${locale}/billing?error=payment_failed`, baseUrl))
    }

    // client_reference: "{shop_id}|{plan_id}|{billing_period}|{tx_ref}|{auto_renew}"
    const parts = (data.client_reference || '').split('|')
    const shop_id = parts[0]
    const plan_id = parts[1]
    const billing_period = (parts[2] || 'monthly') as BillingPeriod
    const auto_renew = parts[4] === '1'

    if (!shop_id || !plan_id) {
      return NextResponse.redirect(new URL(`/${locale}/billing?error=invalid_meta`, baseUrl))
    }

    const supabase = await createAdminClient() as any

    // Idempotency: skip if already processed
    const { data: existing } = await supabase
      .from('subscriptions').select('id').eq('paystack_reference', checkout_id).maybeSingle()
    if (existing) {
      return NextResponse.redirect(new URL(`/${locale}/billing?success=1`, baseUrl))
    }

    const days = getPeriodDays(billing_period)
    const plan_expires_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

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

    await supabase.from('subscriptions').insert({
      shop_id,
      plan: plan_id,
      amount: Number(data.amount) || 0,
      paystack_reference: checkout_id,
      billing_period,
      starts_at: new Date().toISOString(),
      expires_at: plan_expires_at,
      status: 'active',
      auto_renew,
      gateway: 'wave',
      gateway_email: data.client_phone ?? null,
    } as any)

    await writeAuditLog({
      action: 'billing.verify',
      shop_id,
      actor_id: owner_id ?? null,
      target_id: checkout_id,
      target_type: 'wave_payment',
      metadata: { plan_id, billing_period, amount: Number(data.amount) || 0 },
      ip: getClientIp(request),
    })

    return NextResponse.redirect(new URL(`/${locale}/billing?success=1`, baseUrl))
  } catch (err: any) {
    console.error('[billing/wave/verify]', err)
    return NextResponse.redirect(new URL(`/${locale}/billing?error=server`, baseUrl))
  }
}
