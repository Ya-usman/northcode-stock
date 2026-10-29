import { NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { configureWebPush, pushRecipients, onlyAllowed } from '@/lib/api/push-server'
import { checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { getApiTranslator } from '@/lib/api/i18n'

// POST /api/push/new-expense
// Body: { shop_id, description, amount_str, created_by_name }
// Sécurité (29 oct. 2026) : seul un membre qui peut saisir des dépenses dans CETTE boutique déclenche l'envoi ;
// destinataire = le propriétaire seul (l'ancien repli « tous les abonnés » est retiré).
export async function POST(req: Request) {
  const t = getApiTranslator(req)
  try {
    if (!configureWebPush()) return NextResponse.json({ ok: true, skipped: true })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { shop_id, description, amount_str, created_by_name } = await req.json()
    if (!shop_id) return NextResponse.json({ ok: true, skipped: true })
    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !(await canWriteFeature(supabase, role, shop_id, 'expenses', { ignoreHours: true })))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

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

    // Propriétaire seulement (abonnements de cette boutique)
    const allowed = await pushRecipients(admin, shop_id, { ownerOnly: true })
    const { data: rows } = await admin
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, user_id')
      .eq('shop_id', shop_id)
    const targets = onlyAllowed(rows, allowed)

    if (!targets.length) return NextResponse.json({ ok: true, sent: 0 })

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
