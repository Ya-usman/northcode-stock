import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// Max age of an unconfirmed user we're willing to clean up (10 minutes)
const MAX_AGE_MS = 10 * 60 * 1000

export async function POST(request: Request) {
  try {
    const { user_id } = await request.json()
    if (!user_id) return NextResponse.json({ error: 'Missing user_id' }, { status: 400 })

    const admin = await createAdminClient()

    // Fetch the auth user via admin — does not require a session cookie
    const { data: { user }, error: getUserError } = await admin.auth.admin.getUserById(user_id)
    if (getUserError || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Safety guards — only delete if ALL three conditions are met:
    // 1. Email is still unconfirmed (email confirmation flow, not yet clicked the link)
    // 2. Account is very recent (< 10 min) — avoids affecting real users
    // 3. No profile row exists (registration never completed)
    const isUnconfirmed = !user.email_confirmed_at
    const isRecent = Date.now() - new Date(user.created_at).getTime() < MAX_AGE_MS

    if (!isUnconfirmed || !isRecent) {
      return NextResponse.json({ error: 'User does not qualify for cleanup' }, { status: 409 })
    }

    const { data: profile } = await admin.from('profiles').select('id').eq('id', user_id).maybeSingle()
    if (profile) {
      return NextResponse.json({ error: 'Profile exists, skipping cleanup' }, { status: 409 })
    }

    // Safe to delete — orphan unconfirmed user with no profile
    await admin.from('shops').delete().eq('owner_id', user_id)
    await admin.auth.admin.deleteUser(user_id)

    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
