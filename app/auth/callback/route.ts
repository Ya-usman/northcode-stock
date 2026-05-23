import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Supabase auth callback — échange le code PKCE contre une session
// Utilisé pour : confirmation email, reset password, invitation équipe, OAuth
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next')
  const localeCookie = request.headers.get('cookie')?.match(/NEXT_LOCALE=([^;]+)/)?.[1] ?? 'fr'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error) {
      // Set JWT role claim — fire and forget, pas besoin d'attendre
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
