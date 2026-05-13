import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// PATCH /api/team/permissions — save role_permissions JSON on a shop (bypasses RLS via admin client)
export async function PATCH(request: Request) {
  try {
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { shop_id, role_permissions } = await request.json()
    if (!shop_id || role_permissions === undefined) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 })
    }

    // Verify caller is owner or manager of this shop
    const { data: callerMember } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    if (!callerMember || !['owner', 'manager', 'super_admin'].includes(callerMember.role)) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    const admin = await createAdminClient() as any
    const { error } = await admin.from('shops').update({ role_permissions }).eq('id', shop_id)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// PUT /api/team/permissions — toggle can_delete_sales for a shop member
export async function PUT(request: Request) {
  try {
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { shop_id, user_id, can_delete_sales } = await request.json()
    if (!shop_id || !user_id) return NextResponse.json({ error: 'Champs manquants' }, { status: 400 })

    // Verify caller is owner of this specific shop (via user client — respects session)
    const { data: callerMember } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    const isOwner = callerMember?.role === 'owner' || callerMember?.role === 'manager' || callerMember?.role === 'super_admin'
    if (!isOwner) return NextResponse.json({ error: 'Seul le propriétaire peut modifier ces permissions' }, { status: 403 })

    const admin = await createAdminClient() as any

    const { error } = await admin.from('shop_members').update({ can_delete_sales }).eq('shop_id', shop_id).eq('user_id', user_id)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
