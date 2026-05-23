import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

// Supabase auth callback — échange le code PKCE contre une session
// Utilisé pour : confirmation email, reset password, invitation équipe, OAuth
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next')
  const localeCookie = request.headers.get('cookie')?.match(/NEXT_LOCALE=([^;]+)/)?.[1] ?? 'fr'
  const locale = next?.split('/')?.[1] || localeCookie

  if (code) {
    const supabase = await createClient()
    const { data: sessionData, error } = await supabase.auth.exchangeCodeForSession(code)

    if (!error && sessionData.user) {
      const user = sessionData.user

      // Lancer set-role immédiatement en parallèle (pas besoin d'attendre le résultat)
      const setRolePromise = fetch(`${origin}/api/auth/set-role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }).catch(() => {})

      // Pour les connexions OAuth (Google, Apple) : créer profil si inexistant
      if (user.app_metadata?.provider && user.app_metadata.provider !== 'email') {
        const { data: existingProfile } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', user.id)
          .single()

        if (!existingProfile) {
          // Vérifier si un profil existe pour cet email (compte email/password existant)
          const admin = await createAdminClient()
          const { data: profileByEmail } = await (admin as any)
            .from('profiles')
            .select('id')
            .eq('email', user.email)
            .single()

          if (profileByEmail) {
            // Compte email/password existant — inviter à utiliser email/mot de passe
            await Promise.all([setRolePromise, supabase.auth.signOut()])
            return NextResponse.redirect(`${origin}/${locale}/login?error=use_email`)
          }

          // Nouveau compte Google — créer le profil et la boutique
          const fullName = user.user_metadata?.full_name || user.email?.split('@')[0] || 'Utilisateur'
          const res = await fetch(`${origin}/api/register`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${sessionData.session?.access_token}`,
            },
            body: JSON.stringify({
              user_id: user.id,
              full_name: fullName,
              email: user.email,
              shop_name: `Boutique de ${fullName.split(' ')[0]}`,
              city: 'Non défini',
              phone: null,
              country: 'NG',
            }),
          }).catch(() => null)

          if (!res || !res.ok) {
            await supabase.auth.signOut()
            return NextResponse.redirect(`${origin}/${locale}/login?error=no_profile`)
          }
        }
      }

      // Attendre set-role avant de rediriger
      await setRolePromise

      const dest = next ? `${origin}${next}` : `${origin}/${localeCookie}/dashboard`
      return NextResponse.redirect(dest)
    }
  }

  return NextResponse.redirect(`${origin}/${localeCookie}/login?error=lien_invalide`)
}
