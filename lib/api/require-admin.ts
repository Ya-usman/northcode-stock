import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/api/shop-auth'

export type AdminTier = 'super_admin' | 'support'

type RequireAdminResult =
  | { user: any; tier: AdminTier; error?: undefined }
  | { user?: undefined; tier?: undefined; error: NextResponse }

/**
 * Point d'entrée unique pour toute vérification d'accès admin — remplace
 * les ~10 vérifications dupliquées (email allowlist OR profiles.role)
 * précédemment réimplémentées indépendamment dans chaque route
 * app/api/admin/*​/route.ts et dans app/[locale]/(admin)/layout.tsx.
 *
 * Source de vérité unique : la table `admin_users` (migration 124),
 * amorcée avec les emails qui étaient dans SUPER_ADMIN_EMAILS — plus de
 * variable d'environnement à maintenir en parallèle.
 *
 * opts.tier: 'super_admin' exige le niveau complet (un 'support' reçoit
 * un 403 explicite) — omis, les deux niveaux passent (accès en lecture).
 */
export async function requireAdmin(opts?: { tier?: 'super_admin' }): Promise<RequireAdminResult> {
  const { user } = await getAuthedUser()
  if (!user) {
    return { error: NextResponse.json({ error: 'Non authentifié' }, { status: 401 }) }
  }

  const admin = await createAdminClient() as any
  const { data: entry } = await admin
    .from('admin_users')
    .select('tier')
    .eq('user_id', user.id)
    .is('revoked_at', null)
    .maybeSingle()

  if (!entry) {
    return { error: NextResponse.json({ error: 'Accès administrateur requis' }, { status: 403 }) }
  }

  if (opts?.tier === 'super_admin' && entry.tier !== 'super_admin') {
    return { error: NextResponse.json({ error: 'Action réservée aux administrateurs complets' }, { status: 403 }) }
  }

  return { user, tier: entry.tier as AdminTier }
}

/**
 * Variante pour les Server Components (layout, pages) : pas de Request/
 * NextResponse à manipuler, juste le niveau (ou null si pas admin) pour
 * décider quoi afficher/passer en props aux composants client (ex. cacher
 * les boutons de mutation pour le niveau `support`).
 */
export async function getAdminTier(userId: string): Promise<AdminTier | null> {
  const admin = await createAdminClient() as any
  const { data: entry } = await admin
    .from('admin_users')
    .select('tier')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .maybeSingle()
  return (entry?.tier as AdminTier) ?? null
}
