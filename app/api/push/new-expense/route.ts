import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// POST /api/push/new-expense
// Body: { shop_id, description, amount_str, created_by_name }
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

    const { shop_id, description, amount_str, created_by_name } = await req.json()
    if (!shop_id) return NextResponse.json({ ok: true, skipped: true })

    const admin = await createAdminClient() as any

    // Check if the shop has the setting enabled
    const { data: shopRow } = await admin
      .from('shops')
      .select('notify_push_new_expense, owner_id')
      .eq('id', shop_id)
      .single()

    if (!shopRow?.notify_push_new_expense) {
      return NextResponse.json({ ok: true, skipped: true })
    }

    // Only send to the owner's subscriptions
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, user_id')
      .eq('shop_id', shop_id)

    if (!subs?.length) return NextResponse.json({ ok: true, sent: 0 })

    // Filter: only the owner receives this notification
    const ownerSubs = subs.filter((s: any) => s.user_id === shopRow.owner_id)
    // If no owner sub found, fall back to all subs (e.g. multi-shop owner)
    const targets = ownerSubs.length ? ownerSubs : subs

    const title = `💸 Nouvelle dépense ajoutée`
    const body  = [
      description,
      amount_str,
      created_by_name ? `par ${created_by_name}` : '',
    ].filter(Boolean).join(' · ')

    const payload = JSON.stringify({
      title,
      body,
      tag: `new-expense-${shop_id}-${Date.now()}`,
      url: '/expenses',
    })

    const results = await Promise.allSettled(
      targets.map((sub: any) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
      )
    )

    const expired = targets
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
