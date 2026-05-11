import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Supabase auth callback — échange le code PKCE contre une session
// Utilisé pour : reset password, invitation équipe, OAuth
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/fr/dashboard'

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Échec — renvoyer vers login avec erreur
  return NextResponse.redirect(`${origin}/fr/login?error=lien_invalide`)
}
