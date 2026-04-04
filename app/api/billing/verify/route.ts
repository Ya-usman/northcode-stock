import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { PLANS } from '@/lib/saas/plans'

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const reference = searchParams.get('reference')
  const locale = searchParams.get('locale') || 'en'

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `https://${process.env.VERCEL_URL}`

  if (!reference) {
    return NextResponse.redirect(new URL(`/${locale}/billing?error=no_reference`, baseUrl))
  }

  try {
    const secret = process.env.PAYSTACK_SECRET_KEY!

    // Verify with Paystack
    const res = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: { Authorization: `Bearer ${secret}` },
    })
    const data = await res.json()

    if (!data.status || data.data.status !== 'success') {
      return NextResponse.redirect(new URL(`/${locale}/billing?error=payment_failed`, baseUrl))
    }

    const { shop_id, plan_id } = data.data.metadata
    const plan = PLANS[plan_id as keyof typeof PLANS]

    if (!plan || plan.id === 'trial') {
      return NextResponse.redirect(new URL(`/${locale}/billing?error=invalid_plan`, baseUrl))
    }

    const supabase = await createAdminClient()

    // Activate plan: expires in 31 days from now
    const plan_expires_at = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString()

    await supabase.from('shops').update({
      plan: plan_id,
      plan_expires_at,
    } as any).eq('id', shop_id)

    // Record in subscriptions table
    await supabase.from('subscriptions').insert({
      shop_id,
      plan: plan_id,
      amount: data.data.amount / 100,
      paystack_reference: reference,
      starts_at: new Date().toISOString(),
      expires_at: plan_expires_at,
      status: 'active',
    } as any)

    return NextResponse.redirect(new URL(`/${locale}/billing?success=1`, baseUrl))
  } catch (err: any) {
    console.error('[billing/verify]', err)
    return NextResponse.redirect(new URL(`/${locale}/billing?error=server`, baseUrl))
  }
}
