import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

export async function POST(request: Request) {
  try {
    const { employee_id, is_active, shop_id } = await request.json()

    if (!employee_id || !shop_id || typeof is_active !== 'boolean') {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    // Auth check
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    // Check caller is owner of this shop (via shop_members OR profiles fallback)
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

    if (employee_id === user.id) {
      return NextResponse.json({ error: 'Impossible de modifier votre propre compte' }, { status: 400 })
    }

    const admin = await createAdminClient()

    // Fetch the target row (current role/state) — needed for the subordinate
    // check below. profiles has no FK to shop_members (both reference
    // auth.users independently), so the name is fetched separately below —
    // a nested `profiles(full_name)` embed here would fail with no relationship found.
    const { data: targetMember } = await (admin as any)
      .from('shop_members')
      .select('role, is_active')
      .eq('user_id', employee_id)
      .eq('shop_id', shop_id)
      .single()

    if (!targetMember) return NextResponse.json({ error: 'Membre introuvable' }, { status: 404 })

    const { data: targetProfile } = await (admin as any)
      .from('profiles')
      .select('full_name')
      .eq('id', employee_id)
      .single()

    // Managers (manager/shop_manager) can only act on subordinate roles —
    // never on the owner or on peer managers. Only owner/super_admin bypass this.
    if (!['owner', 'super_admin'].includes(callerRole)) {
      if (!['cashier', 'stock_manager', 'viewer'].includes(targetMember.role)) {
        return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
      }
    }

    // Update shop_members.is_active for this shop
    const { error: memberError } = await (admin as any)
      .from('shop_members')
      .update({ is_active })
      .eq('user_id', employee_id)
      .eq('shop_id', shop_id)

    if (memberError) return NextResponse.json({ error: memberError.message }, { status: 500 })

    // Also update profiles.is_active
    await (admin as any).from('profiles').update({ is_active }).eq('id', employee_id)

    // If deactivating: sign out all sessions immediately
    if (!is_active) {
      await (admin as any).auth.admin.signOut(employee_id, 'global')
    }

    await writeAuditLog({
      action: 'member.toggle_active',
      shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: employee_id,
      target_type: 'profile',
      metadata: {
        member_name: targetProfile?.full_name ?? null,
        old_active: targetMember.is_active,
        new_active: is_active,
      },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
