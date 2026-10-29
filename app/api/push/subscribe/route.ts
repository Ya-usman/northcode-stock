import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { checkShopRole } from '@/lib/api/shop-auth'
import { getApiTranslator } from '@/lib/api/i18n'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/push/subscribe — enregistre l'abonnement de l'appareil pour une boutique dont la personne est MEMBRE
// (29 oct. 2026 : auparavant n'importe quelle boutique était acceptée)
export async function POST(req: Request) {
  const t = getApiTranslator(req)
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { subscription, shop_id } = await req.json()
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth || !UUID.test(String(shop_id || '')))
      return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    if (!(await checkShopRole(supabase, user.id, shop_id)))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any
    const { error } = await admin.from('push_subscriptions').upsert({
      user_id: user.id,
      shop_id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    }, { onConflict: 'endpoint' })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/push/subscribe — remove push subscription
export async function DELETE(req: Request) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { endpoint } = await req.json()
    if (!endpoint) return NextResponse.json({ error: 'endpoint requis' }, { status: 400 })

    const admin = await createAdminClient() as any
    await admin.from('push_subscriptions').delete()
      .eq('endpoint', endpoint)
      .eq('user_id', user.id)

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
