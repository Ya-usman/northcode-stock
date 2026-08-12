import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { configureWebPush } from '@/lib/api/push-server'

export async function POST(req: Request) {
  try {
    // Unlike the other push routes (fire-and-forget, silently skip), this one
    // is a deliberate user action ("Tester les notifications") — a silent
    // skip would look like a false success, so surface it clearly instead.
    if (!configureWebPush()) {
      return NextResponse.json({ error: 'Notifications push non configurées sur ce serveur' }, { status: 503 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { shop_id } = await req.json()
    if (!shop_id) return NextResponse.json({ error: 'shop_id requis' }, { status: 400 })

    const admin = await createAdminClient() as any
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('shop_id', shop_id)
      .eq('user_id', user.id)

    if (!subs?.length) return NextResponse.json({ error: 'no_subscription' }, { status: 404 })

    const payload = JSON.stringify({
      title: '✅ Test StockShop',
      body: 'Les notifications fonctionnent correctement !',
      tag: `test-${Date.now()}`,
      url: '/dashboard',
    })

    const results = await Promise.allSettled(
      subs.map((sub: any) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
      )
    )

    const sent = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length
    return NextResponse.json({ ok: true, sent, failed })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
