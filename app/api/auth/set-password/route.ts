import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// POST /api/auth/set-password
//
// Two flows:
// • Invite  : client sends { password, access_token } (raw hash token from email link).
//             Server validates via admin.auth.getUser(token) — fresh token, correct user.
// • Forgot  : client sends { password } only. Server reads session from cookies
//             (set by /auth/callback after server-side PKCE exchange).
//
// The invite token path bypasses stale cookies (which caused "User not found")
// and the setSession() hang (Web Lock contention with other open tabs).
export async function POST(request: Request) {
  try {
    const { password, access_token } = await request.json()

    if (!password) {
      return NextResponse.json({ error: 'Paramètres manquants' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Mot de passe trop court' }, { status: 400 })
    }

    const admin = await createAdminClient() as any
    let userId: string | undefined

    if (access_token) {
      // Invite flow: validate the JWT with Supabase servers (not stale cookies)
      const { data: { user }, error: getUserError } = await admin.auth.getUser(access_token)

      if (user && !getUserError) {
        userId = user.id
      } else if (getUserError?.message === 'User from sub claim in JWT does not exist') {
        // The JWT signature IS valid (GoTrue verified it), but the user was hard-deleted
        // and re-invited, creating a new UUID. Fall back to finding them by email.
        // This is safe because GoTrue already confirmed the token is authentic.
        console.log('[set-password] user deleted/recreated, falling back to email lookup')
        try {
          const payload = JSON.parse(Buffer.from(access_token.split('.')[1], 'base64url').toString('utf-8'))
          const email = payload.email as string | undefined
          if (!email) throw new Error('no email in JWT')

          const { data: { users } } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
          const currentUser = (users ?? []).find((u: any) => u.email === email)
          if (!currentUser) throw new Error('not found by email')
          userId = currentUser.id
          console.log('[set-password] found user by email:', email, '->', userId)
        } catch {
          return NextResponse.json(
            { error: 'Compte introuvable. Redemandez une invitation.' },
            { status: 401 }
          )
        }
      } else {
        // Invalid JWT, expired, or other error
        console.error('[set-password] getUser error:', getUserError?.message)
        return NextResponse.json(
          { error: 'Lien invalide ou expiré. Demandez un nouveau lien.' },
          { status: 401 }
        )
      }
      userId = userId!
    } else {
      // Forgot-password flow: read session from request cookies
      const supabase = await createClient()
      const { data: { session } } = await supabase.auth.getSession()
      userId = session?.user?.id
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'Session invalide ou expirée. Cliquez à nouveau sur le lien dans votre email.' },
        { status: 401 }
      )
    }

    // Update password + confirm email via service role key
    const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
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
