import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getCountry, getPeriodPrice, type BillingPeriod } from '@/lib/saas/countries'

// Map our internal payment method IDs to Paystack channels
function toPaystackChannels(methodId: string): string[] {
  const map: Record<string, string[]> = {
    transfer:   ['bank_transfer'],
    pos:        ['card'],
    opay:       ['mobile_money'],
    palmpay:    ['mobile_money'],
    moniepoint: ['bank_transfer'],
    ussd:       ['ussd'],
  }
  return map[methodId] ?? ['card', 'bank_transfer', 'ussd', 'mobile_money']
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
  try {
    const {
      plan_id, shop_id, email, locale,
      billing_period = 'monthly',
      payment_method = '',
    } = await request.json()

    if (!plan_id || !shop_id || !email) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    if (plan_id === 'trial') {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    const period = billing_period as BillingPeriod
    const supabase = await createAdminClient()
    const { data: shopData } = await supabase
      .from('shops').select('country').eq('id', shop_id).single()

    const country = getCountry((shopData as any)?.country)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL}`
    const monthlyPrice = country.prices[plan_id as keyof typeof country.prices]
    if (!monthlyPrice) {
      return NextResponse.json({ error: 'Invalid plan for this country' }, { status: 400 })
    }

    const amount = getPeriodPrice(monthlyPrice, period)

    // ── Nigeria → Paystack ──────────────────────────────────────────────────
    if (country.gateway === 'paystack') {
      const secret = process.env.PAYSTACK_SECRET_KEY
      if (!secret) return NextResponse.json({ error: 'Paystack not configured' }, { status: 500 })

      const channels = toPaystackChannels(payment_method)

      const res = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          amount: amount * 100,
          callback_url: `${baseUrl}/api/billing/verify?locale=${locale}`,
          metadata: { shop_id, plan_id, locale, billing_period: period, gateway: 'paystack' },
          channels,
        }),
      })
      const data = await res.json()
      if (!data.status) return NextResponse.json({ error: data.message || 'Paystack error' }, { status: 500 })

      return NextResponse.json({
        authorization_url: data.data.authorization_url,
        reference: data.data.reference,
        public_key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '',
        amount_kobo: amount * 100,
        channels,
      })
    }

    // ── NotchPay (Cameroun — Orange Money & MTN MoMo XAF natif) ───────────
    if (country.gateway === 'notchpay') {
      const publicKey = process.env.NOTCHPAY_PUBLIC_KEY
      if (!publicKey) return NextResponse.json({ error: 'NotchPay not configured' }, { status: 500 })

      const res = await fetch('https://api.notchpay.co/payments/initialize', {
        method: 'POST',
        headers: {
          Authorization: publicKey,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          email,
          amount,
          currency: country.currency,
          callback: `${baseUrl}/api/billing/notchpay/verify?locale=${locale}`,
          description: `Abonnement StockShop Plan ${plan_id}`,
          meta: { shop_id, plan_id, locale, billing_period: period },
        }),
      })
      const data = await res.json()
      const url = data.authorization_url
      if (!url) return NextResponse.json({ error: data.message || 'NotchPay error' }, { status: 500 })
      return NextResponse.json({ authorization_url: url, reference: data.transaction?.reference || '' })
    }

    // ── Flutterwave (tous les autres pays FCFA) ────────────────────────────
    if (country.gateway === 'flutterwave') {
      const secretKey = process.env.FLUTTERWAVE_SECRET_KEY
      if (!secretKey) return NextResponse.json({ error: 'Flutterwave not configured' }, { status: 500 })

      const tx_ref = `SS-${shop_id.slice(0, 8)}-${Date.now()}`
      const payment_options = toFlutterwaveOption(payment_method, country.code)

      const res = await fetch('https://api.flutterwave.com/v3/payments', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tx_ref,
          amount,
          currency: country.currency,
          redirect_url: `${baseUrl}/api/billing/flutterwave/verify?locale=${locale}`,
          customer: { email },
          meta: { shop_id, plan_id, locale, billing_period: period },
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
      if (!url) return NextResponse.json({ error: data.message || 'Flutterwave error' }, { status: 500 })

      return NextResponse.json({ authorization_url: url, reference: tx_ref })
    }

    return NextResponse.json({ error: 'Unknown gateway' }, { status: 500 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
