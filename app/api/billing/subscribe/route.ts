import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { PLANS } from '@/lib/saas/plans'

export async function POST(request: Request) {
  try {
    const { plan_id, shop_id, email, locale } = await request.json()

    if (!plan_id || !shop_id || !email) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const plan = PLANS[plan_id as keyof typeof PLANS]
    if (!plan || plan.id === 'trial') {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }

    const secret = process.env.PAYSTACK_SECRET_KEY
    if (!secret) {
      return NextResponse.json({ error: 'Payment not configured' }, { status: 500 })
    }

    // Amount in kobo (Naira × 100)
    const amount = plan.price_monthly * 100

    // Callback URL after payment
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL}`
    const callback_url = `${baseUrl}/api/billing/verify?locale=${locale}`

    // Initialize Paystack transaction
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount,
        callback_url,
        metadata: {
          shop_id,
          plan_id,
          locale,
        },
        channels: ['card', 'bank', 'ussd', 'mobile_money'],
      }),
    })

    const data = await response.json()
    if (!data.status) {
      return NextResponse.json({ error: data.message || 'Paystack error' }, { status: 500 })
    }

    return NextResponse.json({
      authorization_url: data.data.authorization_url,
      reference: data.data.reference,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
