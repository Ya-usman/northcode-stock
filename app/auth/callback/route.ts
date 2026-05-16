import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Supabase auth callback — échange le code PKCE contre une session
// Utilisé pour : confirmation email, reset password, invitation équipe, OAuth
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next')

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Set JWT role claim so RLS and middleware work correctly
      await fetch(`${origin}/api/auth/set-role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).catch(() => {})

      // Redirect to `next` if provided, otherwise detect locale from cookie
      if (next) {
        return NextResponse.redirect(`${origin}${next}`)
      }

      // Read locale from cookie — falls back to 'fr'
      const localeCookie = request.headers.get('cookie')?.match(/NEXT_LOCALE=([^;]+)/)?.[1] ?? 'fr'
      return NextResponse.redirect(`${origin}/${localeCookie}/dashboard`)
    }
  }

  // Échec — renvoyer vers login avec erreur
  const localeCookie = request.headers.get('cookie')?.match(/NEXT_LOCALE=([^;]+)/)?.[1] ?? 'fr'
  return NextResponse.redirect(`${origin}/${localeCookie}/login?error=lien_invalide`)
}
