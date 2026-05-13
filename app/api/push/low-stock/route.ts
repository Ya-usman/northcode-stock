import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// POST /api/push/low-stock
// Check products below threshold and push to subscribed users in the shop
// Body: { shop_id: string, product_ids?: string[] }
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

    const { shop_id, product_ids } = await req.json()
    if (!shop_id) return NextResponse.json({ error: 'shop_id requis' }, { status: 400 })

    const admin = await createAdminClient() as any

    const { data: shop } = await admin
      .from('shops')
      .select('id, name, low_stock_threshold, notify_push_low_stock')
      .eq('id', shop_id)
      .single()

    if (!shop?.notify_push_low_stock) return NextResponse.json({ ok: true, skipped: true })

    const threshold = shop.low_stock_threshold ?? 10

    // Products that just went below threshold
    let lowQuery = admin
      .from('products')
      .select('id, name, quantity, low_stock_threshold')
      .eq('shop_id', shop_id)
      .eq('is_active', true)
      .lte('quantity', threshold)

    if (product_ids?.length) lowQuery = lowQuery.in('id', product_ids)

    const { data: lowProducts } = await lowQuery
    const alerts = (lowProducts || []).filter((p: any) => {
      const t = p.low_stock_threshold ?? threshold
      return p.quantity <= t
    })

    if (!alerts.length) return NextResponse.json({ ok: true, alerts: 0 })

    // Get push subscriptions for this shop
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('shop_id', shop_id)

    if (!subs?.length) return NextResponse.json({ ok: true, alerts: alerts.length, sent: 0 })

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
      tag: `low-stock-${shop_id}`,
      url: '/stock',
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
    return NextResponse.json({ ok: true, alerts: alerts.length, sent })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
