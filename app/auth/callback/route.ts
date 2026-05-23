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
    const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error && sessionData.user) {
      const user = sessionData.user

      // Pour les connexions OAuth (Google, Apple) : créer profil + boutique si inexistants
      if (user.app_metadata?.provider && user.app_metadata.provider !== 'email') {
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', user.id)
          .single()

        if (!existingProfile) {
          // Créer le profil et la boutique via l'API register
          const locale = next?.split('/')?.[1] || 'fr'
          const fullName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Utilisateur'
          const shopName = `Boutique de ${fullName.split(' ')[0]}`

          await fetch(`${origin}/api/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionData.session?.access_token}` },
            body: JSON.stringify({
              user_id: user.id,
              full_name: fullName,
              email: user.email,
              shop_name: shopName,
              city: 'Non défini',
              phone: null,
              country: 'NGA',
            }),
          }).catch(() => {})
        }
      }

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
