import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// PUT /api/team/permissions — toggle can_delete_sales for a shop member
export async function PUT(request: Request) {
  try {
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { shop_id, user_id, can_delete_sales } = await request.json()
    if (!shop_id || !user_id) return NextResponse.json({ error: 'Champs manquants' }, { status: 400 })

    const admin = await createAdminClient() as any

    // Verify caller is owner of this shop
    const { data: callerMember } = await admin.from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', user.id)
      .single()

    const { data: callerProfile } = await admin.from('profiles').select('role').eq('id', user.id).single()
    const isOwner = callerMember?.role === 'owner' || callerProfile?.role === 'owner' || callerProfile?.role === 'super_admin'

    if (!isOwner) return NextResponse.json({ error: 'Seul le propriétaire peut modifier ces permissions' }, { status: 403 })

    const { error } = await admin.from('shop_members').update({ can_delete_sales }).eq('shop_id', shop_id).eq('user_id', user_id)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
