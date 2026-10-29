import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { configureWebPush, pushRecipients, onlyAllowed } from '@/lib/api/push-server'
import { checkShopRole } from '@/lib/api/shop-auth'
import { getApiTranslator } from '@/lib/api/i18n'

// POST /api/push/low-stock
// Check products below threshold and push to subscribed users in the shop
// Body: { shop_id: string, product_ids?: string[] }
// Sécurité (29 oct. 2026) : membre de la boutique seulement ; destinataires = membres actuels avec le droit « Stock ».
export async function POST(req: Request) {
  const t = getApiTranslator(req)
  try {
    if (!configureWebPush()) return NextResponse.json({ ok: true, skipped: true })
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { shop_id, product_ids } = await req.json()
    if (!shop_id) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    if (!(await checkShopRole(supabase, user.id, shop_id))) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

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

    // Abonnés de la boutique qui ont le droit de voir le stock (membres actuels)
    const allowed = await pushRecipients(admin, shop_id, { feature: 'stock' })
    const { data: rows } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, user_id')
      .eq('shop_id', shop_id)
    const subs = onlyAllowed(rows, allowed)

    if (!subs.length) return NextResponse.json({ ok: true, alerts: alerts.length, sent: 0 })

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
