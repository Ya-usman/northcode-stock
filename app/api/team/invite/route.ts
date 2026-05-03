import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

// Use raw supabase-js client with service role to bypass RLS entirely
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function POST(request: Request) {
  try {
    // Verify caller is authenticated and is an owner of the target shop
    const supabase = await createServerClient()
    const { data: { user: caller } } = await supabase.auth.getUser()
    
    if (!caller) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { email, full_name, role, shop_id, invited_by } = await request.json()

    if (!email || !full_name || !role || !shop_id) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    // Only owners and super_admins can invite
    const { data: callerMember } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', caller.id)
      .eq('is_active', true)
      .single()

    if (!callerMember || !['owner', 'super_admin'].includes(callerMember.role)) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    const admin = getAdminClient()

    // Invite user via Supabase Auth Admin
    const { data: { user }, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/en/reset-password`,
      data: { full_name, role, shop_id },
    })

    if (inviteError) {
      return NextResponse.json({ error: inviteError.message }, { status: 400 })
    }

    if (!user) {
      return NextResponse.json({ error: 'Erreur création utilisateur' }, { status: 500 })
    }

    // Create/update profile (service role bypasses RLS)
    const { error: profileError } = await admin.from('profiles').upsert({
      id: user.id,
      full_name,
      role,
      shop_id,
      is_active: true,
    })
    if (profileError) {
      console.error('Profile upsert error:', profileError)
      return NextResponse.json({ error: 'Erreur création profil: ' + profileError.message }, { status: 500 })
    }

    // Create shop_members entry
    const { error: memberError } = await admin.from('shop_members').upsert({
      shop_id,
      user_id: user.id,
      role,
      is_active: true,
      can_delete_sales: false,
      invited_by: invited_by || null,
    }, { onConflict: 'shop_id,user_id' })
    if (memberError) {
      console.error('Shop member upsert error:', memberError)
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
