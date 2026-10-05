import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase/server'
import { logCronRun } from '@/lib/api/cron-log'
import { getExpiryAlerts, userLocales } from '@/lib/alerts/stock-alerts'
import { emailI18n } from '@/lib/email/i18n'
import { expiryPush } from '@/lib/email/notice-templates'

// Alerte de péremption — NOTIFICATIONS PUSH par boutique.
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
      await logCronRun('expiry-alert', 'error', undefined, 'Clés VAPID absentes : notifications push impossibles')
      return NextResponse.json({ error: 'VAPID keys missing' }, { status: 500 })
    }
    webpush.setVapidDetails(process.env.VAPID_MAILTO!, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!)

    const admin = await createAdminClient() as any
    const { data: shops, error: shopsError } = await admin
      .from('shops')
      .select('id, name, expiry_alert_days, notify_push_expiry')
      .is('deleted_at', null)
      .eq('notify_push_expiry', true)
    if (shopsError) throw new Error(shopsError.message)

    const results: Record<string, any> = {}
    const today = new Date()
    for (const shop of shops || []) {
      const { data: subs } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth, user_id').eq('shop_id', shop.id)
      if (!subs?.length) continue // aucun appareil abonné : rien à calculer

      const { expired, expiringSoon } = await getExpiryAlerts(admin, shop, today)
      if (!expired.length && !expiringSoon.length) { results[shop.name] = { alerts: 0 }; continue }

      // Texte dans la langue de l'utilisateur de chaque appareil
      const localeOf = await userLocales(admin, subs.map((s: any) => s.user_id))
      const pushResults = await Promise.allSettled(subs.map((sub: any) => {
        const msg = expiryPush(emailI18n(localeOf.get(sub.user_id)), shop.name, expired, expiringSoon)
        const payload = JSON.stringify({ title: msg.title, body: msg.body, tag: `expiry-${shop.id}`, url: '/stock' })
        return webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
      }))
      // Abonnements expirés (410 Gone) retirés
      const gone = subs.filter((_: any, i: number) => pushResults[i].status === 'rejected' && (pushResults[i] as any).reason?.statusCode === 410).map((s: any) => s.endpoint)
      if (gone.length) await admin.from('push_subscriptions').delete().in('endpoint', gone)
      results[shop.name] = { alerts: expired.length + expiringSoon.length, push: `${pushResults.filter(r => r.status === 'fulfilled').length}/${subs.length} sent` }
    }

    await logCronRun('expiry-alert', 'success', { shops: (shops || []).length, results })
    return NextResponse.json({ ok: true, shops: (shops || []).length, results })
  } catch (err: any) {
    console.error('[cron/expiry-alert]', err)
    await logCronRun('expiry-alert', 'error', undefined, err.message)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
