import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/server'

// GET /api/cron/low-stock-alert
// Called by Vercel Cron every morning — scans all active shops for low/out-of-stock
// products and sends push notifications to subscribed users.
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    webpush.setVapidDetails(
      process.env.VAPID_MAILTO!,
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!
    )

    const admin = await createAdminClient() as any

    // Fetch all shops that have low-stock push alerts enabled
    const { data: shops, error: shopsError } = await admin
      .from('shops')
      .select('id, name, low_stock_threshold, notify_push_low_stock')
      .eq('notify_push_low_stock', true)

    if (shopsError) throw new Error(shopsError.message)
    if (!shops?.length) return NextResponse.json({ ok: true, shops: 0 })

    const results: Record<string, { alerts: number; sent: number; skipped?: boolean }> = {}

    for (const shop of shops) {
      const threshold = shop.low_stock_threshold ?? 10

      // Products below threshold for this shop
      const { data: lowProducts } = await admin
        .from('products')
        .select('id, name, quantity, low_stock_threshold')
        .eq('shop_id', shop.id)
        .eq('is_active', true)
        .lte('quantity', threshold)

      const alerts = (lowProducts || []).filter((p: any) => {
        const t = p.low_stock_threshold ?? threshold
        return p.quantity <= t
      })

      if (!alerts.length) {
        results[shop.name] = { alerts: 0, sent: 0 }
        continue
      }

      // Push subscriptions for this shop
      const { data: subs } = await admin
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('shop_id', shop.id)

      if (!subs?.length) {
        results[shop.name] = { alerts: alerts.length, sent: 0, skipped: true }
        continue
      }

      const outOfStock = alerts.filter((p: any) => p.quantity === 0)
      const lowStock   = alerts.filter((p: any) => p.quantity > 0)

      let body = ''
      if (outOfStock.length === 1) body += `${outOfStock[0].name} est épuisé. `
      else if (outOfStock.length > 1) body += `${outOfStock.length} produits épuisés. `
      if (lowStock.length === 1) body += `${lowStock[0].name} : stock bas (${lowStock[0].quantity}).`
      else if (lowStock.length > 1) body += `${lowStock.length} produits en stock bas.`

      const payload = JSON.stringify({
        title: `⚠️ ${shop.name} — Alerte stock`,
        body: body.trim(),
        tag: `low-stock-${shop.id}`,
        url: '/stock',
      })

      const pushResults = await Promise.allSettled(
        subs.map((sub: any) =>
          webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          )
        )
      )

      // Clean up expired subscriptions (410 Gone)
      const expired = subs
        .filter((_: any, i: number) => {
          const r = pushResults[i]
          return r.status === 'rejected' && (r.reason as any)?.statusCode === 410
        })
        .map((s: any) => s.endpoint)
      if (expired.length) {
        await admin.from('push_subscriptions').delete().in('endpoint', expired)
      }

      const sent = pushResults.filter(r => r.status === 'fulfilled').length
      results[shop.name] = { alerts: alerts.length, sent }
    }

    return NextResponse.json({ ok: true, shops: shops.length, results })
  } catch (err: any) {
    console.error('[cron/low-stock-alert]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
