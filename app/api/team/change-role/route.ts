import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { validateBody, uuid } from '@/lib/api/validate'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'
import { checkShopRole } from '@/lib/api/shop-auth'
import { canManageRole, ASSIGNABLE_ROLES } from '@/lib/team/roles'
import { z } from 'zod'

const changeRoleSchema = z.object({
  member_id: uuid,
  shop_id: uuid,
  new_role: z.enum(ASSIGNABLE_ROLES as [string, ...string[]]),
})

// POST /api/team/change-role — rôle d'une personne DANS une boutique
// (shop_members est par boutique). Hiérarchie unique lib/team/roles.ts :
// l'appelant doit pouvoir gérer l'ancien ET le nouveau rôle.
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const body = await request.json()
    const validated = validateBody(changeRoleSchema, body)
    if ('error' in validated) return validated.error
    const { member_id, shop_id, new_role } = validated.data

    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const callerRole = await checkShopRole(supabase, user.id, shop_id)
    if (!callerRole) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient()

    // profiles has no FK to shop_members (both reference auth.users
    // independently), so the name is fetched separately below.
    const { data: targetMember } = await (admin as any)
      .from('shop_members')
      .select('role, user_id, is_active')
      .eq('id', member_id)
      .eq('shop_id', shop_id)
      .single()

    if (!targetMember || !targetMember.is_active) return NextResponse.json({ error: t('member_not_found') }, { status: 404 })

    if (targetMember.user_id === user.id) {
      return NextResponse.json({ error: t('cannot_modify_own_role') }, { status: 400 })
    }

    if (!canManageRole(callerRole, targetMember.role) || !canManageRole(callerRole, new_role)) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }

    const { data: targetProfile } = await (admin as any)
      .from('profiles')
      .select('full_name')
      .eq('id', targetMember.user_id)
      .single()

    const { error: updateError } = await (admin as any)
      .from('shop_members')
      .update({ role: new_role })
      .eq('id', member_id)

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

    await writeAuditLog({
      action: 'member.role_change',
      shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: targetMember.user_id,
      target_type: 'profile',
      metadata: {
        member_name: targetProfile?.full_name ?? null,
        old_role: targetMember.role,
        new_role,
      },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
