import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getCountry, getPeriodPrice, getPeriodDays, type BillingPeriod } from '@/lib/saas/countries'
import { checkRateLimit } from '@/lib/rate-limit'
import { validateBody, uuid, email as emailSchema, billingPeriodEnum, planEnum } from '@/lib/api/validate'
import { fetchWithTimeout } from '@/lib/api/fetch'
import { getApiTranslator } from '@/lib/api/i18n'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { enforceOwnerPlanLimits } from '@/lib/saas/enforce-limits'
import { previewWalletCredit, applyWalletCredit } from '@/lib/referrals/apply-credit'
import { z } from 'zod'

const subscribeSchema = z.object({
  plan_id: planEnum,
  shop_id: uuid,
  email: emailSchema,
  locale: z.string().max(5).optional(),
  billing_period: billingPeriodEnum.default('monthly'),
  payment_method: z.string().max(50).default(''),
  auto_renew: z.boolean().default(false),
  use_credit: z.boolean().default(false),
})

// Map our internal payment method IDs to Paystack channels.
// 'mobile_money' n'est PAS un canal Paystack valide pour le Nigeria (NGN) — ce
// canal n'existe que pour le Ghana/Kenya/Afrique du Sud sur Paystack. OPay et
// PalmPay sont des néobanques nigérianes qui reçoivent par virement vers un
// compte virtuel dédié, exactement comme Moniepoint — donc bank_transfer ici,
// pas mobile_money (qui faisait échouer tout l'appel transaction/initialize).
function toPaystackChannels(methodId: string): string[] {
  const map: Record<string, string[]> = {
    transfer:   ['bank_transfer'],
    pos:        ['card'],
    opay:       ['bank_transfer'],
    palmpay:    ['bank_transfer'],
    moniepoint: ['bank_transfer'],
    ussd:       ['ussd'],
  }
  return map[methodId] ?? ['card', 'bank_transfer', 'ussd']
}

// Map our internal method IDs to Flutterwave payment_options per country
function toFlutterwaveOption(methodId: string, countryCode: string): string {
  const mobileMoneyByCountry: Record<string, string> = {
    CM: 'mobilemoneycameroon',
    CI: 'mobilemoneycotedivoire',
    ML: 'mobilemoneymali',
    NE: 'mobilemoneyniger',
    SN: 'mobilemoneysenegal',
    BJ: 'mobilemoneybenin',
    GH: 'mobilemoneyghana',
    TG: 'account', // Togo: Flooz/T-Money via account
  }
  if (['wave', 'orange_money', 'mtn_momo', 'moov_money', 'free_money',
       'amana', 'nita', 'airtel_money', 'flooz', 'tmoney'].includes(methodId)) {
    return mobileMoneyByCountry[countryCode] ?? 'mobilemoney'
  }
  if (methodId === 'transfer') return 'banktransfer'
  if (methodId === 'pos') return 'card'
  return 'mobilemoney,card,banktransfer'
}

export async function POST(request: Request) {
  const limited = await checkRateLimit(request, 'billing')
  if (limited) return limited

  const t = getApiTranslator(request)
  try {
    const body = await request.json()
    const validated = validateBody(subscribeSchema, body)
    if ('error' in validated) return validated.error
    const { plan_id, shop_id, email, locale, billing_period, payment_method, auto_renew, use_credit } = validated.data

    const period = billing_period as BillingPeriod
    const supabase = await createAdminClient() as any
    const { data: shopData } = await supabase
      .from('shops').select('country, billing_country, currency, owner_id').eq('id', shop_id).single()

    // billing_country (figé à l'inscription) fait foi pour le montant/la devise/la
    // passerelle — pas `country` (modifiable par l'owner dans Paramètres), sinon le
    // prix affiché sur la page billing (qui utilise déjà billing_country) diverge
    // silencieusement du montant réellement facturé ici.
    const country = getCountry((shopData as any)?.billing_country || (shopData as any)?.country)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL}`
    const monthlyPrice = country.prices[plan_id as keyof typeof country.prices]
    if (!monthlyPrice) {
      return NextResponse.json({ error: t('invalid_plan_for_country') }, { status: 400 })
    }

    const amount = getPeriodPrice(monthlyPrice, period)

    // ── Crédit de parrainage ────────────────────────────────────────────────
    // Réduit ce qui est envoyé à la passerelle (jamais le prix affiché
    // avant) — voir lib/referrals/apply-credit.ts. Le débit réel du wallet
    // n'a lieu qu'à la confirmation du paiement (ou immédiatement ici si le
    // crédit couvre 100% du prix, auquel cas aucune passerelle n'est appelée).
    let amountDue = amount
    let creditApplied = 0
    if (use_credit) {
      const { data: ownerMember } = await supabase
        .from('shop_members').select('user_id').eq('shop_id', shop_id).eq('role', 'owner').eq('is_active', true).maybeSingle()
      const owner_id = ownerMember?.user_id ?? (shopData as any)?.owner_id
      if (owner_id) {
        const preview = await previewWalletCredit(supabase, owner_id, amount, (shopData as any)?.currency || '₦')
        creditApplied = preview.creditApplied
        amountDue = preview.amountDue

        if (creditApplied > 0 && amountDue === 0) {
          // 100% couvert par le crédit — aucune passerelle de paiement n'est
          // jamais appelée. Réplique ce que fait normalement chaque route
          // billing/*/verify après confirmation d'un paiement.
          const days = getPeriodDays(period)
          const plan_expires_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

          await supabase.from('profiles').update({
            plan: plan_id, plan_expires_at, trial_ends_at: null,
          } as any).eq('id', owner_id)

          const { data: newSub } = await supabase.from('subscriptions').insert({
            shop_id, plan: plan_id, amount: 0, billing_period: period,
            paystack_reference: `CREDIT-${shop_id.slice(0, 8)}-${Date.now()}`,
            starts_at: new Date().toISOString(), expires_at: plan_expires_at,
            status: 'active', auto_renew: false, gateway: 'wallet_credit',
          } as any).select('id').single()

          if (newSub?.id) {
            await applyWalletCredit(supabase, {
              userId: owner_id, intendedAmount: creditApplied,
              currency: (shopData as any)?.currency || '₦', subscriptionId: newSub.id,
            })
            await writeAuditLog({
              action: 'billing.verify',
              shop_id, actor_id: owner_id, target_id: newSub.id, target_type: 'subscription',
              metadata: { plan_id, billing_period: period, amount: 0, credit_applied: creditApplied, fully_covered: true },
              ip: getClientIp(request),
            })
            // Pas d'appel à processReferralReward ici : aucun paiement réel
            // (montant facturé = 0) ne doit consommer le "premier paiement"
            // du filleul — voir lib/referrals/process-reward.ts.
            enforceOwnerPlanLimits(supabase, owner_id).catch(() => {})
          }

          return NextResponse.json({ fully_paid: true, credit_applied: creditApplied })
        }
      }
    }

    // ── Nigeria → Paystack ──────────────────────────────────────────────────
    if (country.gateway === 'paystack') {
      const secret = process.env.PAYSTACK_SECRET_KEY
      if (!secret) return NextResponse.json({ error: t('paystack_not_configured') }, { status: 500 })

      const channels = toPaystackChannels(payment_method ?? '')

      const res = await fetchWithTimeout('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          amount: amountDue * 100,
          callback_url: `${baseUrl}/api/billing/verify?locale=${locale}`,
          metadata: { shop_id, plan_id, locale, billing_period: period, gateway: 'paystack', auto_renew, credit_amount: creditApplied },
          channels,
        }),
      })
      const data = await res.json()
      if (!data.status) return NextResponse.json({ error: data.message || t('payment_gateway_error') }, { status: 500 })

      return NextResponse.json({
        authorization_url: data.data.authorization_url,
        reference: data.data.reference,
        public_key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '',
        amount_kobo: amountDue * 100,
        channels,
      })
    }

    // ── NotchPay (Cameroun — Orange Money & MTN MoMo XAF natif) ───────────
    if (country.gateway === 'notchpay') {
      const publicKey = process.env.NOTCHPAY_PUBLIC_KEY
      if (!publicKey) return NextResponse.json({ error: t('notchpay_not_configured') }, { status: 500 })

      const res = await fetchWithTimeout('https://api.notchpay.co/payments/initialize', {
        method: 'POST',
        headers: {
          Authorization: publicKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          email,
          amount: amountDue,
          currency: country.currency,
          callback: `${baseUrl}/api/billing/notchpay/verify?locale=${locale}`,
          description: `Abonnement StockShop Plan ${plan_id}`,
          meta: { shop_id, plan_id, locale, billing_period: period, auto_renew, credit_amount: creditApplied },
        }),
      })
      const data = await res.json()
      const url = data.authorization_url
      if (!url) return NextResponse.json({ error: data.message || t('payment_gateway_error') }, { status: 500 })
      return NextResponse.json({ authorization_url: url, reference: data.transaction?.reference || '' })
    }

    // ── Wave (pays FCFA avec Wave sélectionné) ────────────────────────────
    if (country.gateway === 'flutterwave' && payment_method === 'wave') {
      const waveKey = process.env.WAVE_API_KEY
      if (!waveKey) return NextResponse.json({ error: t('wave_not_configured') }, { status: 500 })

      const tx_ref = `SS-${shop_id.slice(0, 8)}-${Date.now()}`

      const res = await fetchWithTimeout('https://api.wave.com/v1/checkout/sessions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${waveKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: String(amountDue),
          currency: country.currency,
          success_url: `${baseUrl}/api/billing/wave/verify?locale=${locale}`,
          error_url: `${baseUrl}/${locale}/billing?error=payment_failed`,
          // Champs ajoutés en fin de chaîne uniquement — les index existants
          // (parts[0..4]) ne doivent jamais bouger, wave/verify les lit par position.
          client_reference: `${shop_id}|${plan_id}|${period}|${tx_ref}|${auto_renew ? '1' : '0'}|${creditApplied}`,
        }),
      })
      const data = await res.json()
      const url = data.wave_launch_url
      if (!url) return NextResponse.json({ error: data.message || t('payment_gateway_error') }, { status: 500 })

      return NextResponse.json({ authorization_url: url, reference: tx_ref })
    }

    // ── Flutterwave (tous les autres pays FCFA) ────────────────────────────
    if (country.gateway === 'flutterwave') {
      const secretKey = process.env.FLUTTERWAVE_SECRET_KEY
      if (!secretKey) return NextResponse.json({ error: t('flutterwave_not_configured') }, { status: 500 })

      const tx_ref = `SS-${shop_id.slice(0, 8)}-${Date.now()}`
      const payment_options = toFlutterwaveOption(payment_method ?? '', country.code)

      const res = await fetchWithTimeout('https://api.flutterwave.com/v3/payments', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tx_ref,
          amount: amountDue,
          currency: country.currency,
          redirect_url: `${baseUrl}/api/billing/flutterwave/verify?locale=${locale}`,
          customer: { email },
          meta: { shop_id, plan_id, locale, billing_period: period, auto_renew, credit_amount: creditApplied },
          customizations: {
            title: 'StockShop',
            description: `Abonnement Plan ${plan_id}`,
            logo: `${baseUrl}/icons/icon-192x192.png`,
          },
          payment_options,
        }),
      })
      const data = await res.json()
      const url = data.data?.link
      if (!url) return NextResponse.json({ error: data.message || t('payment_gateway_error') }, { status: 500 })

      return NextResponse.json({ authorization_url: url, reference: tx_ref })
    }

    if (country.gateway === 'stripe') {
      return NextResponse.json({ error: 'stripe_coming_soon' }, { status: 400 })
    }

    return NextResponse.json({ error: t('unknown_gateway') }, { status: 500 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
