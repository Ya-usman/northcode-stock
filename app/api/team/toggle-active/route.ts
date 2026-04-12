import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  try {
    const { employee_id, is_active, shop_id } = await request.json()

    if (!employee_id || !shop_id || typeof is_active !== 'boolean') {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    // Auth check
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
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

    if (!callerRole || !['owner', 'super_admin'].includes(callerRole)) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    if (employee_id === user.id) {
      return NextResponse.json({ error: 'Impossible de modifier votre propre compte' }, { status: 400 })
    }

    const admin = await createAdminClient()

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

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
