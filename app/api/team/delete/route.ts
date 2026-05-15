import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: Request) {
  try {
    const { employee_id, shop_id } = await request.json()

    if (!employee_id || !shop_id) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

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
    if (!callerRole || !['owner', 'super_admin'].includes(callerRole)) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    // Prevent deleting yourself
    if (employee_id === user.id) {
      return NextResponse.json({ error: 'Vous ne pouvez pas vous supprimer vous-même' }, { status: 400 })
    }

    const admin = getAdminClient()

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

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
