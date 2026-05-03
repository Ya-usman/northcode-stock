import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  try {
    const { user_id } = await request.json()
    if (!user_id) return NextResponse.json({ error: 'Missing user_id' }, { status: 400 })

    // Verify the caller is authenticated and is the same user requesting cleanup
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user: caller } } = await supabase.auth.getUser()
    if (!caller) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    if (caller.id !== user_id) return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })

    const admin = await createAdminClient()

    // Only delete if no profile exists — prevents deleting active users
    const { data: profile } = await admin.from('profiles').select('id').eq('id', user_id).maybeSingle()
    if (profile) return NextResponse.json({ error: 'Profile exists, skipping cleanup' }, { status: 409 })

    // Safe to delete — incomplete registration (user owns the incomplete shop)
    await admin.from('shops').delete().eq('owner_id', user_id)
    await admin.auth.admin.deleteUser(user_id)

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
