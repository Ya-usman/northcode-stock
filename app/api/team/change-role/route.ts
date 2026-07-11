import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { validateBody, uuid } from '@/lib/api/validate'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { z } from 'zod'

const SUBORDINATE_ROLES = ['cashier', 'stock_manager', 'viewer']

const changeRoleSchema = z.object({
  member_id: uuid,
  shop_id: uuid,
  new_role: z.enum(['shop_manager', 'manager', 'cashier', 'stock_manager', 'viewer']),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const validated = validateBody(changeRoleSchema, body)
    if ('error' in validated) return validated.error
    const { member_id, shop_id, new_role } = validated.data

    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    // Check caller is owner/manager of this shop (via shop_members OR profiles fallback)
    const { data: memberRow } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    let callerRole = memberRow?.role
    if (!callerRole) {
      const { data: profile } = await supabase.from('profiles').select('role, shop_id').eq('id', user.id).single()
      if ((profile as any)?.shop_id === shop_id) callerRole = (profile as any)?.role
    }

    if (!callerRole || !['owner', 'manager', 'shop_manager', 'super_admin'].includes(callerRole)) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    const admin = await createAdminClient()

    // Fetch the target row (current role + member name) — needed for the
    // subordinate check below and for a readable audit log entry.
    const { data: targetMember } = await (admin as any)
      .from('shop_members')
      .select('role, user_id, profiles(full_name)')
      .eq('id', member_id)
      .eq('shop_id', shop_id)
      .single()

    if (!targetMember) return NextResponse.json({ error: 'Membre introuvable' }, { status: 404 })

    if (targetMember.user_id === user.id) {
      return NextResponse.json({ error: 'Impossible de modifier votre propre rôle' }, { status: 400 })
    }

    // Managers (manager/shop_manager) can only act on subordinate roles — never
    // touch the owner or peer managers, and never promote someone to
    // manager/shop_manager themselves. Only owner/super_admin bypass this.
    if (!['owner', 'super_admin'].includes(callerRole)) {
      if (!SUBORDINATE_ROLES.includes(targetMember.role) || !SUBORDINATE_ROLES.includes(new_role)) {
        return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
      }
    }

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
        member_name: targetMember.profiles?.full_name ?? null,
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
