import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { validateBody, uuid } from '@/lib/api/validate'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'
import { checkShopRole } from '@/lib/api/shop-auth'
import { canManageRole } from '@/lib/team/roles'
import { syncPrimaryShop } from '@/lib/api/team-account'
import { z } from 'zod'

const deleteSchema = z.object({
  employee_id: uuid,
  shop_id: uuid,
})

// POST /api/team/delete — « Retirer de cette boutique ».
// Désactive UNIQUEMENT l'affectation à cette boutique (ligne conservée :
// historique et ré-affectation possibles). Le compte de la personne n'est
// JAMAIS désactivé ici, même s'il ne lui reste aucune boutique (décision du
// 5 oct. 2026) — la désactivation du compte est une action distincte et
// confirmée (/api/team/toggle-active). La boutique principale est recalée.
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const body = await request.json()
    const validated = validateBody(deleteSchema, body)
    if ('error' in validated) return validated.error
    const { employee_id, shop_id } = validated.data

    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    if (employee_id === user.id) {
      return NextResponse.json({ error: t('cannot_delete_self') }, { status: 400 })
    }

    const callerRole = await checkShopRole(supabase, user.id, shop_id)

    const admin = createAdminClient() as any
    const { data: targetMember } = await admin
      .from('shop_members')
      .select('id, role, is_active')
      .eq('user_id', employee_id)
      .eq('shop_id', shop_id)
      .maybeSingle()
    if (!targetMember || !targetMember.is_active) return NextResponse.json({ error: t('member_not_found') }, { status: 404 })
    if (targetMember.role === 'owner') return NextResponse.json({ error: t('cannot_remove_owner') }, { status: 403 })

    // Hiérarchie unique (lib/team/roles.ts)
    if (!canManageRole(callerRole, targetMember.role)) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }

    const { data: targetProfile } = await admin.from('profiles').select('full_name').eq('id', employee_id).maybeSingle()

    const { error } = await admin.from('shop_members')
      .update({ is_active: false })
      .eq('id', targetMember.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await syncPrimaryShop(admin, employee_id)

    await writeAuditLog({
      action: 'member.delete',
      shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: employee_id,
      target_type: 'profile',
      metadata: { member_name: targetProfile?.full_name ?? null, role: targetMember.role, scope: 'shop' },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
