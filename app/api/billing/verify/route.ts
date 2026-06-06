import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { PLANS } from '@/lib/saas/plans'
import { getPeriodDays, type BillingPeriod } from '@/lib/saas/countries'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { fetchWithTimeout } from '@/lib/api/fetch'

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

  if (!reference) {
    return reply(inline, locale, baseUrl, false, 'no_reference')
  }

  try {
    const secret = process.env.PAYSTACK_SECRET_KEY!

    const res = await fetchWithTimeout(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${secret}` },
    })
    const data = await res.json()

    // Bank transfer payments may be "pending" when the callback fires — treat as success
    // so the plan is activated immediately. Paystack webhook will confirm later.
    const txStatus = data.data?.status
    if (!data.status || (txStatus !== 'success' && txStatus !== 'pending')) {
      return reply(inline, locale, baseUrl, false, 'payment_failed')
    }

    const { shop_id, plan_id, billing_period = 'monthly' } = data.data.metadata
    const plan = PLANS[plan_id as keyof typeof PLANS]

    if (!plan || plan.id === 'trial') {
      return reply(inline, locale, baseUrl, false, 'invalid_plan')
    }

    const supabase = await createAdminClient() as any

    // Idempotency: skip if this reference was already processed
    const { data: existing } = await supabase
      .from('subscriptions').select('id').eq('paystack_reference', reference).maybeSingle()
    if (existing) {
      return reply(inline, locale, baseUrl, true)
    }

    const days = getPeriodDays(billing_period as BillingPeriod)
    const plan_expires_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

    // Get owner_id and agent_id to update profile (owner-level billing)
    const { data: shopRow } = await supabase.from('shops').select('owner_id, agent_id').eq('id', shop_id).single()
    const owner_id = (shopRow as any)?.owner_id
    const agent_id = (shopRow as any)?.agent_id

    if (owner_id) {
      // Update profiles — single source of truth
      await supabase.from('profiles').update({
        plan: plan_id,
        plan_expires_at,
        trial_ends_at: null,
      } as any).eq('id', owner_id)

      // Backward compat: sync all active shops owned by this user
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
      amount: data.data.amount / 100,
      paystack_reference: reference,
      billing_period,
      starts_at: new Date().toISOString(),
      expires_at: plan_expires_at,
      status: 'active',
    } as any)

    // Créer une commission pour l'agent qui a parrainé cette boutique
    if (agent_id) {
      const { data: agentRow } = await supabase
        .from('agents')
        .select('commission_rate')
        .eq('id', agent_id)
        .maybeSingle()
      if (agentRow) {
        const paymentAmount = data.data.amount / 100
        const commissionAmount = (paymentAmount * (agentRow as any).commission_rate) / 100
        await supabase.from('agent_commissions').insert({
          agent_id,
          shop_id,
          subscription_amount: paymentAmount,
          commission_amount: commissionAmount,
          plan_id,
          billing_period,
          paystack_reference: reference,
          status: 'pending',
        } as any)
      }
    }

    await writeAuditLog({
      action: 'billing.verify',
      shop_id,
      actor_id: owner_id ?? null,
      target_id: reference,
      target_type: 'paystack_payment',
      metadata: { plan_id, billing_period, amount: data.data.amount / 100 },
      ip: getClientIp(request),
    })

    return reply(inline, locale, baseUrl, true)
  } catch (err: any) {
    console.error('[billing/verify]', err)
    return reply(inline, locale, baseUrl, false, 'server')
  }
}
