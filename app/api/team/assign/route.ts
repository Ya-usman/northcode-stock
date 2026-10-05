import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { validateBody, uuid } from '@/lib/api/validate'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'
import { checkShopRole } from '@/lib/api/shop-auth'
import { canManageRole, ASSIGNABLE_ROLES } from '@/lib/team/roles'
import { resolveAccountOwnerId, checkTeamSeat } from '@/lib/saas/team-quota'
import { listAccountPersonIds, syncPrimaryShop } from '@/lib/api/team-account'
import { z } from 'zod'

// POST /api/team/assign — affecter une personne DÉJÀ présente dans le compte à
// une boutique du compte (jamais de nouvel utilisateur). Contrôles : droits de
// l'appelant dans la boutique cible, rôle attribuable par lui, personne du
// compte, compte actif, pas de doublon d'affectation, quota (règle unique de
// lib/saas/team-quota.ts : une personne déjà comptée ne consomme pas de
// nouveau siège), journal d'audit.
const assignSchema = z.object({
  shop_id: uuid,
  user_id: uuid,
  role: z.enum(ASSIGNABLE_ROLES as [string, ...string[]]),
})

export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const validated = validateBody(assignSchema, await request.json())
    if ('error' in validated) return validated.error
    const { shop_id, user_id, role } = validated.data

    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    if (user_id === user.id) return NextResponse.json({ error: t('cannot_modify_own_account') }, { status: 400 })

    const callerRole = await checkShopRole(supabase, user.id, shop_id)
    if (!canManageRole(callerRole, role)) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = createAdminClient() as any
    const ownerId = await resolveAccountOwnerId(admin, shop_id)
    if (!ownerId) return NextResponse.json({ error: t('shop_not_found') }, { status: 404 })
    if (user_id === ownerId) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    // La personne doit déjà appartenir au compte
    const accountPeople = await listAccountPersonIds(admin, ownerId)
    if (!accountPeople.includes(user_id)) return NextResponse.json({ error: t('not_in_account') }, { status: 404 })

    const [{ data: profile }, { data: memberships }] = await Promise.all([
      admin.from('profiles').select('full_name, is_active').eq('id', user_id).maybeSingle(),
      admin.from('shop_members').select('id, shop_id, role, is_active, suspended_by_plan').eq('user_id', user_id),
    ])
    if (!profile) return NextResponse.json({ error: t('member_not_found') }, { status: 404 })
    if (profile.is_active === false) return NextResponse.json({ error: t('account_deactivated') }, { status: 409 })

    const existing = (memberships || []).find((m: any) => m.shop_id === shop_id)
    if (existing?.is_active) return NextResponse.json({ error: t('already_assigned') }, { status: 409 })

    // Un appelant qui n'est pas propriétaire ne peut affecter qu'une personne
    // dont tous les rôles actuels relèvent de lui (un Responsable n'affecte pas
    // un Manager comme caissier dans sa boutique).
    if (callerRole !== 'owner' && callerRole !== 'super_admin') {
      const activeRoles = (memberships || []).filter((m: any) => m.is_active).map((m: any) => m.role)
      if (activeRoles.some((r: string) => !canManageRole(callerRole, r))) {
        return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
      }
    }

    const { ok, seats } = await checkTeamSeat(admin, ownerId, user_id)
    if (!ok) {
      return NextResponse.json(
        { error: t('team_limit_reached', { plan: seats.planName, limit: seats.limit }), code: 'team_limit' },
        { status: 403 }
      )
    }

    if (existing) {
      // Ancienne affectation retirée : on la réactive avec le nouveau rôle
      const { error } = await admin.from('shop_members')
        .update({ is_active: true, role, suspended_by_plan: false })
        .eq('id', existing.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      const { error } = await admin.from('shop_members').insert({
        shop_id, user_id, role, is_active: true, can_delete_sales: false, invited_by: user.id,
      })
      if (error) {
        // Course entre deux clics : la contrainte unique (shop_id, user_id) protège déjà
        if ((error as any).code === '23505') return NextResponse.json({ error: t('already_assigned') }, { status: 409 })
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }

    await syncPrimaryShop(admin, user_id, shop_id)

    await writeAuditLog({
      action: 'member.assign',
      shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: user_id,
      target_type: 'profile',
      metadata: { member_name: profile.full_name ?? null, role, reactivated: !!existing },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
