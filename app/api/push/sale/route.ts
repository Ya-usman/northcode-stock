import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { configureWebPush } from '@/lib/api/push-server'
import { formatCurrency } from '@/lib/utils/currency'
import { getLocaleTranslator } from '@/lib/api/i18n'

// POST /api/push/sale
// Notify shop owner(s) when a cashier completes a sale
// Body: { shop_id, total, currency_symbol, cashier_name, payment_label }
export async function POST(req: Request) {
  try {
    if (!configureWebPush()) return NextResponse.json({ ok: true, skipped: true })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { shop_id, total, currency_symbol, cashier_name, payment_label } = await req.json()
    if (!shop_id) return NextResponse.json({ error: 'shop_id requis' }, { status: 400 })

    const admin = await createAdminClient() as any

    const { data: shop } = await admin
      .from('shops')
      .select('id, name, currency, notify_push_new_sale')
      .eq('id', shop_id)
      .single()

    if (!shop?.notify_push_new_sale) return NextResponse.json({ ok: true, skipped: true })

    // Get push subscriptions for this shop, excluding the cashier themselves
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, user_id')
      .eq('shop_id', shop_id)
      .neq('user_id', user.id)

    if (!subs?.length) return NextResponse.json({ ok: true, sent: 0 })

    // Montant écrit comme partout dans l'application (devise de la boutique) ; ancien format en repli
    const amount = shop.currency
      ? formatCurrency(Number(total), shop.currency)
      : `${currency_symbol}${Number(total).toLocaleString('fr-FR')}`
    const body = cashier_name
      ? `${cashier_name} — ${amount} via ${payment_label}`
      : `${amount} via ${payment_label}`

    // Titre dans la langue de chaque destinataire (profil), jamais figé en français
    const { data: profs } = await admin.from('profiles').select('id, locale').in('id', subs.map((s: any) => s.user_id))
    const localeOf = new Map<string, string | null>((profs || []).map((p: any) => [p.id, p.locale]))
    const tag = `sale-${shop_id}-${Date.now()}`
    const payloadFor = (userId: string) => JSON.stringify({
      title: `💰 ${getLocaleTranslator(localeOf.get(userId), 'sales')('sale_label')} — ${shop.name}`,
      body,
      tag,
      url: '/sales/history',
    })

    const results = await Promise.allSettled(
      subs.map((sub: any) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payloadFor(sub.user_id)
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
    return NextResponse.json({ ok: true, sent })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
