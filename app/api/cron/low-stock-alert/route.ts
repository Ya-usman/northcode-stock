import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/server'
import { logCronRun } from '@/lib/api/cron-log'
import { getLowStockAlerts } from '@/lib/alerts/stock-alerts'

// Alerte de stock faible — NOTIFICATIONS PUSH par boutique.
// L'e-mail est envoyé par la tâche owner-alerts (un seul e-mail par
// propriétaire, toutes boutiques et alertes regroupées).

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const secret = process.env.CRON_SECRET
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const canPush = !!(process.env.VAPID_MAILTO && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
    if (!canPush) {
      await logCronRun('low-stock-alert', 'error', undefined, 'Clés VAPID absentes : notifications push impossibles')
      return NextResponse.json({ error: 'VAPID keys missing' }, { status: 500 })
    }
    webpush.setVapidDetails(process.env.VAPID_MAILTO!, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!)

    const admin = await createAdminClient() as any
    const { data: shops, error: shopsError } = await admin
      .from('shops')
      .select('id, name, low_stock_threshold, notify_push_low_stock')
      .is('deleted_at', null)
      .eq('notify_push_low_stock', true)
    if (shopsError) throw new Error(shopsError.message)

    const results: Record<string, any> = {}
    for (const shop of shops || []) {
      const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth').eq('shop_id', shop.id)
      if (!subs?.length) continue // aucun appareil abonné : rien à calculer

      const { outOfStock, lowStock } = await getLowStockAlerts(admin, shop)
      if (!outOfStock.length && !lowStock.length) { results[shop.name] = { alerts: 0 }; continue }

      let body = ''
      if (outOfStock.length === 1) body += `${outOfStock[0].name} est épuisé. `
      else if (outOfStock.length > 1) body += `${outOfStock.length} produits épuisés. `
      if (lowStock.length === 1) body += `${lowStock[0].name} : stock bas (${lowStock[0].quantity}).`
      else if (lowStock.length > 1) body += `${lowStock.length} produits en stock bas.`

      const payload = JSON.stringify({ title: `⚠️ ${shop.name} — Alerte stock`, body: body.trim(), tag: `low-stock-${shop.id}`, url: '/stock' })
      const pushResults = await Promise.allSettled(subs.map((sub: any) =>
        webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)))
      // Abonnements expirés (410 Gone) retirés
      const expired = subs.filter((_: any, i: number) => pushResults[i].status === 'rejected' && (pushResults[i] as any).reason?.statusCode === 410).map((s: any) => s.endpoint)
      if (expired.length) await admin.from('push_subscriptions').delete().in('endpoint', expired)
      results[shop.name] = { alerts: outOfStock.length + lowStock.length, push: `${pushResults.filter(r => r.status === 'fulfilled').length}/${subs.length} sent` }
    }

    await logCronRun('low-stock-alert', 'success', { shops: (shops || []).length, results })
    return NextResponse.json({ ok: true, shops: (shops || []).length, results })
  } catch (err: any) {
    console.error('[cron/low-stock-alert]', err)
    await logCronRun('low-stock-alert', 'error', undefined, err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
