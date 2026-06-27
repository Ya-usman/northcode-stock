import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

// POST /api/auth/set-password
// Decodes the JWT payload locally (no network call), then updates the
// password via admin.auth.admin.updateUserById (service role key).
// Avoids admin.auth.getUser(token) which GoTrue rejects for invited
// users before email confirmation.
export async function POST(request: Request) {
  try {
    const { password, access_token } = await request.json()

    if (!password || !access_token) {
      return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Mot de passe trop court' }, { status: 400 })
    }

    // Decode JWT payload to get user_id without a network call.
    // admin.auth.getUser(token) makes a /auth/v1/user request that GoTrue
    // rejects for invited users not yet confirmed. Instead we decode the JWT
    // manually and verify via admin.auth.admin.getUserById (service role key).
    let userId: string
    try {
      const parts = access_token.split('.')
      if (parts.length !== 3) throw new Error('malformed')
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))
      if (!payload.sub) throw new Error('no sub')
      if (payload.aud !== 'authenticated') throw new Error('wrong audience')
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
        return NextResponse.json(
          { error: 'Session expirée. Cliquez à nouveau sur le lien dans votre email.' },
          { status: 401 }
        )
      }
      userId = payload.sub as string
    } catch (decodeErr: any) {
      return NextResponse.json(
        { error: 'Lien invalide ou expiré. Demandez un nouveau lien.' },
        { status: 401 }
      )
    }

    const admin = await createAdminClient() as any

    // Verify user actually exists in auth.users (service role — no JWT auth needed)
    const { data: { user }, error: getUserError } = await admin.auth.admin.getUserById(userId)
    if (getUserError || !user) {
      return NextResponse.json(
        { error: 'Lien invalide ou expiré. Demandez un nouveau lien.' },
        { status: 401 }
      )
    }

    // Set password + confirm email in one admin call
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
