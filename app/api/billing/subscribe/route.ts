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
      return NextResponse.json({
        authorization_url: data.data.authorization_url,
        reference: data.data.reference,
        // Extra fields for Paystack Inline popup
        public_key: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY || '',
        amount_kobo: amount * 100,
      })
    }

    // ── Cameroun → Flutterwave ──────────────────────────────────────────────
    if (country.gateway === 'flutterwave') {
      const secretKey = process.env.FLUTTERWAVE_SECRET_KEY
      if (!secretKey) return NextResponse.json({ error: 'Flutterwave not configured' }, { status: 500 })

      const tx_ref = `NC-${shop_id.slice(0, 8)}-${Date.now()}`

      const res = await fetch('https://api.flutterwave.com/v3/payments', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tx_ref,
          amount,
          currency: 'XAF',
          redirect_url: `${baseUrl}/api/billing/flutterwave/verify?locale=${locale}`,
          customer: { email },
          meta: { shop_id, plan_id, locale },
          customizations: {
            title: 'NorthCode Stock',
            description: `Abonnement Plan ${plan_id}`,
            logo: `${baseUrl}/icons/icon-192x192.png`,
          },
          payment_options: 'mobilemoneyfranco',
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
