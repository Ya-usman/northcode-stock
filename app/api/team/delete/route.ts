import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { validateBody, uuid } from '@/lib/api/validate'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { z } from 'zod'

const deleteSchema = z.object({
  employee_id: uuid,
  shop_id: uuid,
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const validated = validateBody(deleteSchema, body)
    if ('error' in validated) return validated.error
    const { employee_id, shop_id } = validated.data

    // Verify caller is owner or super_admin
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    // Verify caller is owner/super_admin of THIS specific shop
    const { data: callerMember } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    const callerRole = callerMember?.role
    if (!callerRole || !['owner', 'manager', 'shop_manager', 'super_admin'].includes(callerRole)) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    // Prevent deleting yourself
    if (employee_id === user.id) {
      return NextResponse.json({ error: 'Vous ne pouvez pas vous supprimer vous-même' }, { status: 400 })
    }

    const admin = createAdminClient() as any

    // Managers (manager/shop_manager) can only delete subordinate roles —
    // never the owner or peer managers. Only owner/super_admin bypass this.
    if (!['owner', 'super_admin'].includes(callerRole)) {
      const { data: targetMember } = await admin
        .from('shop_members')
        .select('role')
        .eq('user_id', employee_id)
        .eq('shop_id', shop_id)
        .single()
      if (!targetMember || !['cashier', 'stock_manager', 'viewer'].includes(targetMember.role)) {
        return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
      }
    }

    // 1. Deactivate membership for this shop (soft delete — preserves sales attribution)
    await admin.from('shop_members')
      .update({ is_active: false })
      .eq('user_id', employee_id)
      .eq('shop_id', shop_id)

    // 2. Check if the user has active memberships in other shops
    const { data: otherActiveMemberships } = await admin
      .from('shop_members')
      .select('id')
      .eq('user_id', employee_id)
      .eq('is_active', true)

    // 3. If no other active shop, deactivate the profile (no auth deletion — history preserved)
    if (!otherActiveMemberships || otherActiveMemberships.length === 0) {
      await admin.from('profiles').update({ is_active: false }).eq('id', employee_id)
    }

    await writeAuditLog({
      action: 'member.delete',
      shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: employee_id,
      target_type: 'profile',
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
