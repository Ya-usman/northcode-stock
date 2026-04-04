import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const { email, full_name, role, shop_id } = await request.json()

    if (!email || !full_name || !role || !shop_id) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    const supabase = await createAdminClient()

    // Invite user via Supabase Auth Admin
    const { data: { user }, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/en/login`,
      data: {
        full_name,
        role,
        shop_id,
      },
    })

    if (inviteError) {
      return NextResponse.json({ error: inviteError.message }, { status: 400 })
    }

    if (user) {
      // Create profile for invited user
      const { error: profileError } = await supabase.from('profiles').upsert({
        id: user.id,
        full_name,
        role,
        shop_id,
        is_active: true,
      })

      if (profileError) {
        console.error('Profile creation error:', profileError)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
