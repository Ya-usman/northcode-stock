import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'

const ALLOWED_ROLES = ['owner', 'manager', 'shop_manager', 'super_admin']

export async function GET(request: Request) {
  const supabase = await createClient() as any
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const shopIds = searchParams.get('shop_ids')?.split(',').filter(Boolean) || []
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (!shopIds.length) return NextResponse.json({ logs: [] })

  // Verify caller has manager+ access to the requested shops
  const { data: memberships } = await supabase
    .from('shop_members')
    .select('shop_id, role')
    .in('shop_id', shopIds)
    .eq('user_id', user.id)
    .eq('is_active', true)
    .in('role', ALLOWED_ROLES)

  const allowedShopIds = (memberships || []).map((m: any) => m.shop_id)

  // super_admin bypass: if user is super_admin at profile level, allow all
  const { data: profileRow } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  const effectiveShopIds = profileRow?.role === 'super_admin' ? shopIds : allowedShopIds
  if (!effectiveShopIds.length) return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })

  const admin = await createAdminClient() as any

  let query = admin
    .from('audit_logs')
    .select('id, action, actor_id, actor_email, target_id, target_type, metadata, created_at')
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
      actor_name: actorMap[l.actor_id] || l.actor_email || 'Inconnu',
    })),
  })
}
