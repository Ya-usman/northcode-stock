import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { checkShopRole } from '@/lib/api/shop-auth'
import { isAccountOwner } from '@/lib/team/roles'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { permissionChanges } from '@/lib/permissions'

// Configuration des permissions — RÉSERVÉE AU PROPRIÉTAIRE (décision du
// 5 oct. 2026). Avant, un Manager ou un Responsable pouvait modifier
// shops.role_permissions, donc s'attribuer lui-même des droits.

// PATCH /api/team/permissions — save role_permissions JSON on a shop (bypasses RLS via admin client)
export async function PATCH(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { shop_id, role_permissions } = await request.json()
    if (!shop_id || role_permissions === undefined) {
      return NextResponse.json({ error: t('missing_fields') }, { status: 400 })
    }

    const callerRole = await checkShopRole(supabase, user.id, shop_id)
    if (!isAccountOwner(callerRole)) {
      return NextResponse.json({ error: t('owner_only_permissions') }, { status: 403 })
    }

    const admin = await createAdminClient() as any
    const { data: before } = await admin.from('shops').select('role_permissions').eq('id', shop_id).maybeSingle()
    const { error } = await admin.from('shops').update({ role_permissions }).eq('id', shop_id)
    if (error) throw error

    // Journal : une entrée par droit RÉELLEMENT changé (valeur appliquée avant / après, anciens réglages compris) —
    // aucune si le même réglage est renvoyé.
    const changes = permissionChanges(before?.role_permissions ?? null, role_permissions)
    if (changes.length) {
      const { data: actorProfile } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
      for (const c of changes) {
        await writeAuditLog({
          action: 'permissions.update', shop_id, actor_id: user.id, actor_email: user.email,
          target_id: shop_id, target_type: 'shop', ip: getClientIp(request),
          metadata: { actor_name: actorProfile?.full_name || user.email, role: c.role, permission: c.permission, from: c.from, to: c.to },
        })
      }
    }

    return NextResponse.json({ success: true, changes: changes.length })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PUT /api/team/permissions — toggle can_delete_sales for a shop member
export async function PUT(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { shop_id, user_id, can_delete_sales } = await request.json()
    if (!shop_id || !user_id) return NextResponse.json({ error: t('missing_fields') }, { status: 400 })

    const callerRole = await checkShopRole(supabase, user.id, shop_id)
    if (!isAccountOwner(callerRole)) return NextResponse.json({ error: t('owner_only_permissions') }, { status: 403 })
    if (user_id === user.id) return NextResponse.json({ error: t('cannot_modify_own_account') }, { status: 400 })

    const admin = await createAdminClient() as any

    const { error } = await admin.from('shop_members').update({ can_delete_sales }).eq('shop_id', shop_id).eq('user_id', user_id)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
