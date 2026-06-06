import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// POST /api/push/recurring-expense
// Body: { shop_id, count, amount_str? }
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

    const { shop_id, count, amount_str } = await req.json()
    if (!shop_id || !count) return NextResponse.json({ ok: true, skipped: true })

    const admin = await createAdminClient() as any

    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('shop_id', shop_id)

    if (!subs?.length) return NextResponse.json({ ok: true, sent: 0 })

    const title = count > 1
      ? `🔄 ${count} dépenses récurrentes générées`
      : `🔄 Dépense récurrente générée`

    const payload = JSON.stringify({
      title,
      body: amount_str || '',
      tag: `recurring-${shop_id}-${Date.now()}`,
      url: '/expenses',
    })

    const results = await Promise.allSettled(
      subs.map((sub: any) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
      )
    )

    const expired = subs
      .filter((_: any, i: number) => {
        const r = results[i]
        return r.status === 'rejected' && (r.reason as any)?.statusCode === 410
      })
      .map((s: any) => s.endpoint)

    if (expired.length) {
      await admin.from('push_subscriptions').delete().in('endpoint', expired)
    }

    return NextResponse.json({ ok: true, sent: results.filter(r => r.status === 'fulfilled').length })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
