import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  // Flutterwave sends: status, tx_ref, transaction_id
  const status = searchParams.get('status')
  const tx_ref = searchParams.get('tx_ref')
  const transaction_id = searchParams.get('transaction_id')
  const locale = searchParams.get('locale') || 'en'

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    || `https://${process.env.VERCEL_URL}`
    || `${request.nextUrl.protocol}//${request.nextUrl.host}`

  if (status !== 'successful') {
    return NextResponse.redirect(new URL(`/${locale}/billing?error=payment_failed`, baseUrl))
  }

  if (!transaction_id) {
    return NextResponse.redirect(new URL(`/${locale}/billing?error=no_reference`, baseUrl))
  }

  try {
    const secretKey = process.env.FLUTTERWAVE_SECRET_KEY!

    // Verify transaction with Flutterwave
    const res = await fetch(`https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    })
    const data = await res.json()

    if (data.status !== 'success' || data.data?.status !== 'successful') {
      return NextResponse.redirect(new URL(`/${locale}/billing?error=payment_failed`, baseUrl))
    }

    const { shop_id, plan_id } = data.data?.meta || {}

    if (!shop_id || !plan_id) {
      return NextResponse.redirect(new URL(`/${locale}/billing?error=invalid_meta`, baseUrl))
    }

    const supabase = await createAdminClient()
    const plan_expires_at = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString()

    await supabase.from('shops').update({
      plan: plan_id,
      plan_expires_at,
    } as any).eq('id', shop_id)

    await supabase.from('subscriptions').insert({
      shop_id,
      plan: plan_id,
      amount: data.data?.amount || 0,
      paystack_reference: tx_ref,
      starts_at: new Date().toISOString(),
      expires_at: plan_expires_at,
      status: 'active',
    } as any)

    return NextResponse.redirect(new URL(`/${locale}/billing?success=1`, baseUrl))
  } catch (err: any) {
    console.error('[billing/flutterwave/verify]', err)
    return NextResponse.redirect(new URL(`/${locale}/billing?error=server`, baseUrl))
  }
}
