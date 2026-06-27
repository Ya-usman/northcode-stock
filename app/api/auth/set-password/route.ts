import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// POST /api/auth/set-password
// Reads the authenticated session from server-side cookies (set by /auth/callback)
// instead of trusting a client-provided JWT. Cookies are signed by Supabase and
// cannot be forged, so no JWT signature verification is needed. Works for both
// the forgot-password flow and the invite flow.
export async function POST(request: Request) {
  try {
    const { password } = await request.json()

    if (!password) {
      return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Mot de passe trop court' }, { status: 400 })
    }

    // Read session from request cookies — no client-provided token needed.
    const supabase = await createClient()
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()

    // Also try getUser() which validates the token with GoTrue servers
    const { data: { user: validatedUser }, error: getUserError } = await supabase.auth.getUser()

    const userId = validatedUser?.id ?? session?.user?.id

    console.log('[set-password]', {
      hasSession: !!session,
      sessionUserId: session?.user?.id,
      sessionUserEmail: session?.user?.email,
      validatedUserId: validatedUser?.id,
      validatedUserEmail: validatedUser?.email,
      sessionError: sessionError?.message,
      getUserError: getUserError?.message,
      finalUserId: userId,
    })

    if (!userId) {
      return NextResponse.json(
        { error: 'Session invalide ou expirée. Cliquez à nouveau sur le lien dans votre email.' },
        { status: 401 }
      )
    }

    const admin = await createAdminClient() as any

    // Update password + confirm email via service role key (no user-state restrictions)
    const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
    })
    if (updateError) {
      console.error('[set-password] updateUserById error:', updateError.message, 'userId:', userId)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[set-password]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
