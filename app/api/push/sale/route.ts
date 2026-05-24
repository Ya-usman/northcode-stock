import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// POST /api/push/sale
// Notify shop owner(s) when a cashier completes a sale
// Body: { shop_id, total, currency_symbol, cashier_name, payment_label }
export async function POST(req: Request) {
  try {
    webpush.setVapidDetails(
      process.env.VAPID_MAILTO!,
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    )

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { shop_id, total, currency_symbol, cashier_name, payment_label } = await req.json()
    if (!shop_id) return NextResponse.json({ error: 'shop_id requis' }, { status: 400 })

    const admin = await createAdminClient() as any

    const { data: shop } = await admin
      .from('shops')
      .select('id, name, notify_push_new_sale')
      .eq('id', shop_id)
      .single()

    if (!shop?.notify_push_new_sale) return NextResponse.json({ ok: true, skipped: true })

    // Get push subscriptions for this shop, excluding the cashier themselves
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, user_id')
      .eq('shop_id', shop_id)
      .neq('user_id', user.id)

    if (!subs?.length) return NextResponse.json({ ok: true, sent: 0 })

    const amount = `${currency_symbol}${Number(total).toLocaleString('fr-FR')}`
    const body = cashier_name
      ? `${cashier_name} — ${amount} via ${payment_label}`
      : `${amount} via ${payment_label}`

    const payload = JSON.stringify({
      title: `💰 Vente — ${shop.name}`,
      body,
      tag: `sale-${shop_id}-${Date.now()}`,
      url: '/sales/history',
    })

    const results = await Promise.allSettled(
      subs.map((sub: any) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
      )
    )

    // Clean up expired subscriptions (HTTP 410 Gone)
    const expired = subs
      .filter((_: any, i: number) => {
        const r = results[i]
        return r.status === 'rejected' && (r.reason as any)?.statusCode === 410
      })
      .map((s: any) => s.endpoint)

    if (expired.length) {
      await admin.from('push_subscriptions').delete().in('endpoint', expired)
    }

    const sent = results.filter(r => r.status === 'fulfilled').length
    return NextResponse.json({ ok: true, sent })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
