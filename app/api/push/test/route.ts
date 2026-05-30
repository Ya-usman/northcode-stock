import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient, createAdminClient } from '@/lib/supabase/server'

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
