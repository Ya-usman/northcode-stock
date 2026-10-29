import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { configureWebPush, pushRecipients, onlyAllowed } from '@/lib/api/push-server'
import { checkShopRole } from '@/lib/api/shop-auth'
import { getApiTranslator } from '@/lib/api/i18n'

// POST /api/push/recurring-expense
// Body: { shop_id, count, amount_str? }
// Sécurité (29 oct. 2026) : membre de la boutique seulement ; destinataires = membres actuels avec le droit « Dépenses ».
export async function POST(req: Request) {
  const t = getApiTranslator(req)
  try {
    if (!configureWebPush()) return NextResponse.json({ ok: true, skipped: true })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { shop_id, count, amount_str } = await req.json()
    if (!shop_id || !count) return NextResponse.json({ ok: true, skipped: true })
    if (!(await checkShopRole(supabase, user.id, shop_id))) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any

    const allowed = await pushRecipients(admin, shop_id, { feature: 'expenses' })
    const { data: rows } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, user_id')
      .eq('shop_id', shop_id)
    const subs = onlyAllowed(rows, allowed)

    if (!subs.length) return NextResponse.json({ ok: true, sent: 0 })

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
