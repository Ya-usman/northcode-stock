import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)

export async function POST(request: Request) {
  try {
    // Verify caller is super admin
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    

    const isAdmin = user && SUPER_ADMIN_EMAILS.includes(user.email || '')
    if (!isAdmin) {
      // Also check DB role
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user?.id ?? '').single()
      if (profile?.role !== 'super_admin') {
        return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
      }
    }

    const { email, shop_id, role = 'owner' } = await request.json()
    if (!email || !shop_id) return NextResponse.json({ error: 'email et shop_id requis' }, { status: 400 })

    const admin = await createAdminClient()

    // Find user by email
    const { data: { users }, error: listError } = await admin.auth.admin.listUsers()
    if (listError) throw listError

    const targetUser = users.find(u => u.email === email)
    if (!targetUser) return NextResponse.json({ error: `Aucun compte trouvé pour ${email}` }, { status: 404 })

    // Upsert into shop_members
    const { error: memberError } = await admin.from('shop_members').upsert({
      shop_id,
      user_id: targetUser.id,
      role,
      is_active: true,
    } as any, { onConflict: 'shop_id,user_id' })

    if (memberError) throw memberError

    // Also update profiles.shop_id if not set
    await admin.from('profiles').update({ shop_id, role } as any)
      .eq('id', targetUser.id)
      .is('shop_id', null)

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
