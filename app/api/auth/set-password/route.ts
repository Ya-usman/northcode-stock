import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// POST /api/auth/set-password
// Used by reset-password page to update the password via admin API,
// bypassing client-side JWT validation issues (e.g. "User from sub claim
// in JWT does not exist" when localStorage has a stale session).
export async function POST(request: Request) {
  try {
    const { password, access_token } = await request.json()

    if (!password || !access_token) {
      return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Mot de passe trop court' }, { status: 400 })
    }

    const admin = await createAdminClient() as any

    // Validate the access_token and get the user it belongs to
    const { data: { user }, error: getUserError } = await admin.auth.getUser(access_token)
    if (getUserError || !user) {
      return NextResponse.json(
        { error: 'Lien invalide ou expiré. Demandez un nouveau lien.' },
        { status: 401 }
      )
    }

    // Update password + confirm email in one admin call
    const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
      password,
      email_confirm: true,
    })
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('[set-password]', err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
