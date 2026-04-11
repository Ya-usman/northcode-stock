import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const { email, full_name, role, shop_id, invited_by } = await request.json()

    if (!email || !full_name || !role || !shop_id) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    const supabase = await createAdminClient() as any

    // Invite user via Supabase Auth Admin
    const { data: { user }, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/en/reset-password`,
      data: { full_name, role, shop_id },
    })

    if (inviteError) {
      return NextResponse.json({ error: inviteError.message }, { status: 400 })
    }

    if (user) {
      // Create/update profile
      await supabase.from('profiles').upsert({
        id: user.id,
        full_name,
        role,
        shop_id,
        is_active: true,
      })

      // Create shop_members entry (upsert in case they're re-invited)
      await supabase.from('shop_members').upsert({
        shop_id,
        user_id: user.id,
        role,
        is_active: true,
        can_delete_sales: false,
        invited_by: invited_by || null,
      }, { onConflict: 'shop_id,user_id' })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
