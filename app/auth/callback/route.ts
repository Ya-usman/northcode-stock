import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
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
      //
      // IMPORTANT : ce fetch doit être attendu, ET porter le cookie de session
      // FRAÎCHEMENT écrit par exchangeCodeForSession (pas celui de la requête entrante,
      // capturé avant l'échange — il ne contient pas encore le nouveau token). Sans ces
      // deux points, set-role (qui auto-provisionne shop+profil pour les nouveaux comptes
      // Google/Apple) échoue silencieusement en 401 ou est tué avant de finir sur Vercel
      // si la réponse est déjà partie — confirmé en base : un utilisateur Google réel sans
      // aucune ligne profiles/shop_members malgré ce code déjà en place.
      if (!confirmed) {
        const cookieStore = await cookies()
        const cookieHeader = cookieStore.getAll().map(c => `${c.name}=${c.value}`).join('; ')
        // Géolocalisation IP de la requête OAuth d'origine (celle du navigateur) —
        // le fetch interne ci-dessous part du serveur lui-même, donc son propre
        // x-vercel-ip-country ne reflète plus l'utilisateur réel. On la transmet
        // sous un nom distinct pour que set-role l'utilise pour l'auto-provisioning
        // des nouveaux comptes Google/Apple (devise/passerelle adaptées au pays réel
        // au lieu d'être toujours codées en dur sur le Nigeria).
        const geoCountry = request.headers.get('x-vercel-ip-country')
        await fetch(`${origin}/api/auth/set-role`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            cookie: cookieHeader,
            ...(geoCountry ? { 'x-user-country': geoCountry } : {}),
          },
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

  // Pas de code PKCE → flux OTP hash-based (ex: admin.inviteUserByEmail).
  // Le token est dans le fragment URL (#access_token=…) qui n'est pas visible
  // côté serveur. Si `next` est fourni, on redirige vers cette page et laisse
  // le code client gérer le hash (reset-password/page.tsx le fait déjà).
  if (next) {
    return NextResponse.redirect(`${origin}${next}`)
  }

  return NextResponse.redirect(`${origin}/${localeCookie}/login?error=lien_invalide`)
}
