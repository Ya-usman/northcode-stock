import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { checkShopRole } from '@/lib/api/shop-auth'
import { isTeamManager } from '@/lib/team/roles'
import { resolveAccount } from '@/lib/saas/team-quota'
import { listAccountPersonIds } from '@/lib/api/team-account'

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// POST /api/team/status — e-mail, confirmation d'e-mail et dernière connexion
// des personnes demandées. Réservé à la gestion d'équipe (Propriétaire,
// Manager, Responsable) et LIMITÉ aux personnes du compte de la boutique
// (avant le 5 oct. 2026, n'importe quel identifiant était accepté).
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createServerClient() as any
    const { data: { user: caller } } = await supabase.auth.getUser()
    if (!caller) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { user_ids, shop_id } = await request.json()
    if (!Array.isArray(user_ids) || !shop_id) {
      return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    }

    const callerRole = await checkShopRole(supabase, caller.id, shop_id)
    if (!isTeamManager(callerRole)) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }

    const admin = getAdminClient() as any
    const account = await resolveAccount(admin, shop_id)
    if (!account?.ownerId) return NextResponse.json({ status: {} })
    const allowed = new Set([account.ownerId, ...(await listAccountPersonIds(admin, account))])
    const ids = (user_ids as string[]).filter(id => typeof id === 'string' && allowed.has(id)).slice(0, 200)

    const results = await Promise.allSettled(ids.map(id => admin.auth.admin.getUserById(id)))

    const statusMap: Record<string, { email: string | null; email_confirmed_at: string | null; last_sign_in_at: string | null }> = {}
    results.forEach((result: any, i) => {
      if (result.status === 'fulfilled' && result.value.data.user) {
        const u = result.value.data.user
        statusMap[ids[i]] = {
          email: u.email ?? null,
          email_confirmed_at: u.email_confirmed_at ?? null,
          last_sign_in_at: u.last_sign_in_at ?? null,
        }
      }
    })

    return NextResponse.json({ status: statusMap })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
