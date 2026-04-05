import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getCountry } from '@/lib/saas/countries'

export async function POST(request: Request) {
  try {
    const { plan_id, shop_id, email, locale } = await request.json()

    if (!plan_id || !shop_id || !email) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (plan_id === 'trial') {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    // Fetch shop country to route to the right gateway
    const supabase = await createAdminClient()
    const { data: shopData } = await supabase
      .from('shops')
      .select('country')
      .eq('id', shop_id)
      .single()

    const country = getCountry((shopData as any)?.country)
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL}`
    const amount = country.prices[plan_id as keyof typeof country.prices]

    if (!amount) {
      return NextResponse.json({ error: 'Invalid plan for this country' }, { status: 400 })
    }

    // ── Nigeria → Paystack ──────────────────────────────────────────────────
    if (country.gateway === 'paystack') {
      const secret = process.env.PAYSTACK_SECRET_KEY
      if (!secret) return NextResponse.json({ error: 'Paystack not configured' }, { status: 500 })

      const res = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          amount: amount * 100, // kobo
          callback_url: `${baseUrl}/api/billing/verify?locale=${locale}`,
          metadata: { shop_id, plan_id, locale, gateway: 'paystack' },
          channels: ['card', 'bank', 'ussd', 'mobile_money'],
        }),
      })
      const data = await res.json()
      if (!data.status) return NextResponse.json({ error: data.message || 'Paystack error' }, { status: 500 })
      return NextResponse.json({ authorization_url: data.data.authorization_url, reference: data.data.reference })
    }

    // ── Cameroun → NotchPay ─────────────────────────────────────────────────
    if (country.gateway === 'notchpay') {
      const publicKey = process.env.NOTCHPAY_PUBLIC_KEY
      if (!publicKey) return NextResponse.json({ error: 'NotchPay not configured' }, { status: 500 })

      const reference = `NC-${shop_id.slice(0, 8)}-${Date.now()}`

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
          currency: 'XAF',
          description: `NorthCode Stock — Plan ${plan_id}`,
          reference,
          callback: `${baseUrl}/api/billing/notchpay/verify?locale=${locale}`,
          meta: { shop_id, plan_id, locale, gateway: 'notchpay' },
        }),
      })
      const data = await res.json()
      const url = data.authorization_url || data.transaction?.payment_url
      if (!url) return NextResponse.json({ error: data.message || 'NotchPay error' }, { status: 500 })
      return NextResponse.json({ authorization_url: url, reference })
    }

    return NextResponse.json({ error: 'Unknown gateway' }, { status: 500 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
