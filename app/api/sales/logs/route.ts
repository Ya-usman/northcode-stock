import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { isManagerial, shopsWithView } from '@/lib/api/role-permissions'

export async function GET(request: Request) {
  const t = getApiTranslator(request)
  const supabase = await createClient() as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const shopIds = searchParams.get('shop_ids')?.split(',').filter(Boolean) || []
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (!shopIds.length) return NextResponse.json({ logs: [] })

  // Boutique par boutique : rôle de direction DANS la boutique ET droit « Historique des ventes » en consultation.
  // Avant : rôle seul, et passe-droit pour un profil super_admin (rôle global) sur TOUTES les boutiques demandées,
  // y compris d'autres entreprises — supprimé (règle : jamais le rôle global du profil pour une donnée de boutique).
  const access = await shopsWithView(supabase, user.id, shopIds, ['sales_history'])
  const effectiveShopIds = access.ids.filter(id => isManagerial(access.roles[id]))
  if (!effectiveShopIds.length) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

  const admin = await createAdminClient() as any

  let query = admin
    .from('audit_logs')
    .select('id, shop_id, action, actor_id, actor_email, target_id, target_type, metadata, created_at')
    .in('shop_id', effectiveShopIds)
    .eq('target_type', 'sale')
    .order('created_at', { ascending: false })
    .limit(300)

  if (from) query = query.gte('created_at', from)
  if (to) query = query.lte('created_at', to)

  const { data: logs, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Enrich actor names from profiles
  const actorIds = Array.from(new Set((logs || []).map((l: any) => l.actor_id).filter(Boolean))) as string[]
  const { data: actors } = actorIds.length
    ? await admin.from('profiles').select('id, full_name').in('id', actorIds)
    : { data: [] }

  const actorMap = Object.fromEntries((actors || []).map((a: any) => [a.id, a.full_name]))

  return NextResponse.json({
    logs: (logs || []).map((l: any) => ({
      ...l,
      actor_name: actorMap[l.actor_id] || l.actor_email || t('unknown'),
    })),
  })
}
