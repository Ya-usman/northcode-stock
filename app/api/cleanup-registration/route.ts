import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const { user_id } = await request.json()
    if (!user_id) return NextResponse.json({ error: 'Missing user_id' }, { status: 400 })

    const supabase = await createAdminClient()

    // Verify the user exists in Auth
    const { data: { user }, error: authError } = await supabase.auth.admin.getUserById(user_id)
    if (authError || !user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Only delete if no profile exists — prevents deleting active users
    const { data: profile } = await supabase.from('profiles').select('id').eq('id', user_id).maybeSingle()
    if (profile) return NextResponse.json({ error: 'Profile exists, skipping cleanup' }, { status: 409 })

    // Safe to delete — incomplete registration
    await supabase.from('shops').delete().eq('owner_id', user_id)
    await supabase.auth.admin.deleteUser(user_id)

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
