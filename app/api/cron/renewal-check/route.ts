import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getPeriodDays, type BillingPeriod } from '@/lib/saas/countries'
import { fetchWithTimeout } from '@/lib/api/fetch'
import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createAdminClient() as any
  const now = new Date()
  const in3Days = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString()
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

  // Find active auto-renew subscriptions expiring within 3 days
  const { data: subs } = await supabase
    .from('subscriptions')
    .select('id, shop_id, plan, billing_period, amount, gateway, gateway_authorization, gateway_email, renewal_failures')
    .eq('auto_renew', true)
    .eq('status', 'active')
    .lt('expires_at', in3Days)
    .gt('expires_at', now.toISOString())
    .lt('renewal_failures', 3)
    .or(`last_renewal_attempt_at.is.null,last_renewal_attempt_at.lt.${oneDayAgo}`)

  if (!subs?.length) {
    return NextResponse.json({ processed: 0 })
  }

  let charged = 0, reminded = 0, failed = 0

  for (const sub of subs as any[]) {
    await supabase.from('subscriptions').update({
      last_renewal_attempt_at: now.toISOString(),
    }).eq('id', sub.id)

    // ── Paystack auto-charge ────────────────────────────────────────────────
    if (sub.gateway === 'paystack' && sub.gateway_authorization && sub.gateway_email) {
      try {
        const secret = process.env.PAYSTACK_SECRET_KEY!
        const res = await fetchWithTimeout('https://api.paystack.co/transaction/charge_authorization', {
          method: 'POST',
          headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            authorization_code: sub.gateway_authorization,
            email: sub.gateway_email,
            amount: Math.round(sub.amount * 100),
            metadata: { shop_id: sub.shop_id, plan_id: sub.plan, billing_period: sub.billing_period, is_renewal: true },
          }),
        })
        const data = await res.json()

        if (data.status && data.data?.status === 'success') {
          const days = getPeriodDays(sub.billing_period as BillingPeriod)
          const newExpiry = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()

          await supabase.from('subscriptions').update({
            expires_at: newExpiry,
            renewal_failures: 0,
            last_renewal_attempt_at: now.toISOString(),
          }).eq('id', sub.id)

          const { data: shopRow } = await supabase.from('shops').select('owner_id').eq('id', sub.shop_id).single()
          const owner_id = (shopRow as any)?.owner_id
          if (owner_id) {
            await supabase.from('profiles').update({ plan: sub.plan, plan_expires_at: newExpiry } as any).eq('id', owner_id)
            await supabase.from('shops').update({ plan: sub.plan, plan_expires_at: newExpiry } as any).eq('owner_id', owner_id).is('deleted_at', null)
          }

          await supabase.from('subscriptions').insert({
            shop_id: sub.shop_id,
            plan: sub.plan,
            amount: sub.amount,
            paystack_reference: data.data.reference,
            billing_period: sub.billing_period,
            starts_at: now.toISOString(),
            expires_at: newExpiry,
            status: 'active',
            auto_renew: true,
            gateway: 'paystack',
            gateway_authorization: sub.gateway_authorization,
            gateway_email: sub.gateway_email,
          } as any)

          charged++
        } else {
          await supabase.from('subscriptions').update({
            renewal_failures: (sub.renewal_failures || 0) + 1,
          }).eq('id', sub.id)
          failed++
        }
      } catch {
        await supabase.from('subscriptions').update({
          renewal_failures: (sub.renewal_failures || 0) + 1,
        }).eq('id', sub.id)
        failed++
      }
      continue
    }

    // ── Reminder email for non-Paystack gateways ───────────────────────────
    if (sub.gateway_email && process.env.RESEND_API_KEY) {
      try {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.stockshop.tech'
        const planLabel = (sub.plan as string).charAt(0).toUpperCase() + (sub.plan as string).slice(1)
        await resend.emails.send({
          from: 'StockShop <no-reply@stockshop.tech>',
          to: sub.gateway_email,
          subject: `Renouvellement de votre abonnement StockShop ${planLabel}`,
          html: `
            <p>Bonjour,</p>
            <p>Votre abonnement StockShop <strong>${planLabel}</strong> expire dans moins de 3 jours.</p>
            <p>Renouvelez dès maintenant pour garder accès à toutes vos données :</p>
            <p><a href="${appUrl}/fr/billing" style="background:#073e8a;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Renouveler mon abonnement</a></p>
            <p style="color:#666;font-size:12px;">Si vous ne souhaitez plus être contacté, vous pouvez désactiver le renouvellement automatique depuis votre espace facturation.</p>
          `,
        })
        reminded++
      } catch {
        // Email failure is non-critical
      }
    }
  }

  return NextResponse.json({ processed: subs.length, charged, reminded, failed })
}
