import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Supabase auth callback — échange le code PKCE contre une session
// Utilisé pour : confirmation email, reset password, invitation équipe, OAuth
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next')
  const localeCookie = request.headers.get('cookie')?.match(/NEXT_LOCALE=([^;]+)/)?.[1] ?? 'fr'

  // signout=1 → confirmation email : on confirme puis on déconnecte
  // pour renvoyer l'utilisateur à la page de connexion sans session active
  const signout = searchParams.get('signout') === '1'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      if (signout) {
        // Email confirmation flow : email confirmé, session détruite → login
        await supabase.auth.signOut()
        const dest = next ? `${origin}${next}` : `${origin}/${localeCookie}/login?confirmed=1`
        return NextResponse.redirect(dest)
      }

      // OAuth / reset password / invitation : garder la session
      fetch(`${origin}/api/auth/set-role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).catch(() => {})

      const dest = next ? `${origin}${next}` : `${origin}/${localeCookie}/dashboard`
      return NextResponse.redirect(dest)
    }
  }

  return NextResponse.redirect(`${origin}/${localeCookie}/login?error=lien_invalide`)
}
