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
