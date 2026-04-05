import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const reference = searchParams.get('reference') || searchParams.get('trxref')
  const locale = searchParams.get('locale') || 'en'

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL}`

  if (!reference) {
    return NextResponse.redirect(new URL(`/${locale}/billing?error=no_reference`, baseUrl))
  }

  try {
    const publicKey = process.env.NOTCHPAY_PUBLIC_KEY!

    // Verify with NotchPay
    const res = await fetch(`https://api.notchpay.co/payments/${reference}`, {
      headers: {
        Authorization: publicKey,
        Accept: 'application/json',
      },
    })
    const data = await res.json()

    // NotchPay returns status 'complete' for successful payments
    const txStatus = data.transaction?.status || data.payment?.status
    if (txStatus !== 'complete' && txStatus !== 'success') {
      return NextResponse.redirect(new URL(`/${locale}/billing?error=payment_failed`, baseUrl))
    }

    const meta = data.transaction?.meta || data.payment?.meta || {}
    const { shop_id, plan_id } = meta

    if (!shop_id || !plan_id) {
      return NextResponse.redirect(new URL(`/${locale}/billing?error=invalid_meta`, baseUrl))
    }

    const supabase = await createAdminClient()
    const plan_expires_at = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString()

    await supabase.from('shops').update({
      plan: plan_id,
      plan_expires_at,
    } as any).eq('id', shop_id)

    const amount = data.transaction?.amount || data.payment?.amount || 0

    await supabase.from('subscriptions').insert({
      shop_id,
      plan: plan_id,
      amount,
      paystack_reference: reference,
      starts_at: new Date().toISOString(),
      expires_at: plan_expires_at,
      status: 'active',
    } as any)

    return NextResponse.redirect(new URL(`/${locale}/billing?success=1`, baseUrl))
  } catch (err: any) {
    console.error('[billing/notchpay/verify]', err)
    return NextResponse.redirect(new URL(`/${locale}/billing?error=server`, baseUrl))
  }
}
