import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Supabase auth callback — échange le code PKCE contre une session
// Utilisé pour : confirmation email, reset password, invitation équipe, OAuth
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next')
  const localeCookie = request.headers.get('cookie')?.match(/NEXT_LOCALE=([^;]+)/)?.[1] ?? 'fr'

  // confirmed=1 → confirmation email : la page login se charge de signOut() côté client
  // (signOut() serveur ne propage pas ses cookies dans NextResponse.redirect)
  const confirmed = searchParams.get('confirmed') === '1'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Pour la confirmation email, on ne définit pas le rôle — l'utilisateur va se déconnecter
      // côté client sur la page login avant de se reconnecter normalement
      if (!confirmed) {
        fetch(`${origin}/api/auth/set-role`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }).catch(() => {})
      }

      // Ajouter ?confirmed=1 à la destination si le flag est présent
      const confirmedSuffix = confirmed ? '?confirmed=1' : ''
      const dest = next
        ? `${origin}${next}${confirmedSuffix}`
        : confirmed
          ? `${origin}/${localeCookie}/login?confirmed=1`
          : `${origin}/${localeCookie}/dashboard`
      return NextResponse.redirect(dest)
    }
  }

  return NextResponse.redirect(`${origin}/${localeCookie}/login?error=lien_invalide`)
}
