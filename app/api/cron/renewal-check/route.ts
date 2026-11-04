import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { BILLING_PERIODS, type BillingPeriod } from '@/lib/saas/countries'
import { fetchWithTimeout } from '@/lib/api/fetch'
import { logCronRun } from '@/lib/api/cron-log'
import { getAccountForShop } from '@/lib/saas/entity'
import { computePlanCharge } from '@/lib/billing/plan-charge'
import { createPaymentIntent, newPaymentReference, findPaymentIntent, settlePayment, failPaymentIntent } from '@/lib/billing/payment-intents'
import { Resend } from 'resend'
import { EMAIL_FROM, appBaseUrl } from '@/lib/email/sender'
import { emailI18n } from '@/lib/email/i18n'
import { buildRenewalEmail } from '@/lib/email/notice-templates'
import { getPlan } from '@/lib/saas/plans'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
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
    await logCronRun('renewal-check', 'success', { processed: 0 })
    return NextResponse.json({ processed: 0 })
  }

  let charged = 0, reminded = 0, failed = 0

  for (const sub of subs as any[]) {
    await supabase.from('subscriptions').update({
      last_renewal_attempt_at: now.toISOString(),
    }).eq('id', sub.id)

    // ── Prélèvement automatique Paystack (carte enregistrée) ────────────────
    // Même règle que le paiement manuel (4 nov. 2026) : montant = formule + options reconduites, calculé par
    // lib/billing/plan-charge ; paiement PRÉPARÉ (migration 204) puis confirmé par settlePayment (montant et devise
    // vérifiés, options appliquées, nouvel abonnement, limites remises en ordre). Avant : l'ancien montant était
    // prélevé tel quel, sans les options et sans vérification.
    if (sub.gateway === 'paystack' && sub.gateway_authorization && sub.gateway_email) {
      let reference: string | null = null
      try {
        const account = await getAccountForShop(supabase, sub.shop_id)
        const period = (sub.billing_period in BILLING_PERIODS ? sub.billing_period : 'monthly') as BillingPeriod
        const plan = (['starter', 'pro', 'business'].includes(sub.plan) ? sub.plan : null) as 'starter' | 'pro' | 'business' | null
        const charge = account && plan ? await computePlanCharge(supabase, account, plan, period) : null
        if (!account || !plan || !charge) throw new Error('renouvellement impossible à calculer')
        reference = newPaymentReference(sub.shop_id)
        const prepared = await createPaymentIntent(supabase, {
          reference, gateway: 'paystack', entity_id: account.entityId, shop_id: sub.shop_id, owner_id: account.ownerId,
          plan, billing_period: period, currency: charge.currency, amount: charge.amount, credit_applied: 0, amount_due: charge.amount,
          auto_renew: true, request_country: null, pricing_reason: charge.pricing.reason, pricing_country: charge.pricing.country,
          kind: 'plan', addon_seats: charge.renew.seats, addon_shops: charge.renew.shops,
        })
        if (!prepared.ok) throw new Error(prepared.error)
        const secret = process.env.PAYSTACK_SECRET_KEY!
        const res = await fetchWithTimeout('https://api.paystack.co/transaction/charge_authorization', {
          method: 'POST',
          headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            authorization_code: sub.gateway_authorization,
            email: sub.gateway_email,
            reference,
            currency: charge.currency,
            amount: Math.round(charge.amount * 100),
            metadata: { shop_id: sub.shop_id, plan_id: plan, billing_period: period, is_renewal: true },
          }),
        })
        const data = await res.json()

        if (data.status && data.data?.status === 'success') {
          const intent = await findPaymentIntent(supabase, 'paystack', { reference })
          const settled = intent ? await settlePayment(supabase, intent, {
            amount: Number(data.data.amount) / 100, currency: data.data.currency, gatewayTxId: data.data.id != null ? String(data.data.id) : null,
            authorization: sub.gateway_authorization, email: sub.gateway_email, last4: data.data.authorization?.last4 ?? null,
            payerCountry: data.data.authorization?.country_code ?? null,
          }, request) : { status: 'review' as const, reason: 'intent_missing' }
          // L'ancien abonnement ne se renouvelle plus : le nouveau (créé par settlePayment) porte le renouvellement
          await supabase.from('subscriptions').update({ auto_renew: false, renewal_failures: 0, last_renewal_attempt_at: now.toISOString() }).eq('id', sub.id)
          if (settled.status === 'review') failed++
          else charged++
        } else {
          await failPaymentIntent(supabase, reference, String(data.message || data.data?.gateway_response || 'paystack_charge_failed'))
          await supabase.from('subscriptions').update({
            renewal_failures: (sub.renewal_failures || 0) + 1,
          }).eq('id', sub.id)
          failed++
        }
      } catch (e: any) {
        if (reference) await failPaymentIntent(supabase, reference, String(e?.message || 'renewal_error'))
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
        // Langue du propriétaire de l'entreprise de la boutique, français à défaut
        const account = await getAccountForShop(supabase, sub.shop_id)
        const { data: owner } = account?.ownerId ? await supabase.from('profiles').select('locale').eq('id', account.ownerId).maybeSingle() : { data: null }
        const mail = buildRenewalEmail(emailI18n(owner?.locale), { plan: getPlan(sub.plan).name, appUrl: appBaseUrl() })
        await resend.emails.send({ from: EMAIL_FROM, to: sub.gateway_email, subject: mail.subject, html: mail.html })
        reminded++
      } catch {
        // Email failure is non-critical
      }
    }
  }

  const summary = { processed: subs.length, charged, reminded, failed }
  await logCronRun('renewal-check', 'success', summary)
  return NextResponse.json(summary)
  } catch (err: any) {
    console.error('[renewal-check]', err)
    await logCronRun('renewal-check', 'error', undefined, err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
