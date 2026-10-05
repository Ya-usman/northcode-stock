import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { validateBody, uuid, email as emailSchema, shortText } from '@/lib/api/validate'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'
import { checkShopRole } from '@/lib/api/shop-auth'
import { canManageRole, ASSIGNABLE_ROLES } from '@/lib/team/roles'
import { resolveAccount, checkTeamSeat } from '@/lib/saas/team-quota'
import { findAccountMemberByEmail } from '@/lib/api/team-account'
import { z } from 'zod'

const inviteSchema = z.object({
  email: emailSchema,
  full_name: shortText,
  role: z.enum(ASSIGNABLE_ROLES as [string, ...string[]]),
  shop_id: uuid,
  invited_by: uuid.optional().nullable(),
})

// Use raw supabase-js client with service role to bypass RLS entirely
function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// POST /api/team/invite — inviter une NOUVELLE personne dans une boutique.
// Si l'adresse appartient déjà à une personne du compte, on ne crée rien et
// on renvoie 409 { code: 'member_exists', user_id, full_name } : l'interface
// propose alors « Affecter ce membre à cette boutique » (/api/team/assign).
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createServerClient() as any
    const { data: { user: caller } } = await supabase.auth.getUser()
    if (!caller) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const body = await request.json()
    const validated = validateBody(inviteSchema, body)
    if ('error' in validated) return validated.error
    const { email, full_name, role, shop_id } = validated.data

    // Hiérarchie unique (lib/team/roles.ts) : Propriétaire → tous les rôles ;
    // Manager → Responsable et équipe opérationnelle ; Responsable → équipe opérationnelle.
    const callerRole = await checkShopRole(supabase, caller.id, shop_id)
    if (!canManageRole(callerRole, role)) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }

    const admin = getAdminClient() as any
    const account = await resolveAccount(admin, shop_id)
    if (!account?.ownerId) return NextResponse.json({ error: t('shop_not_found') }, { status: 404 })
    const ownerId = account.ownerId

    // Personne déjà dans le compte → jamais de doublon d'utilisateur
    const existing = await findAccountMemberByEmail(admin, account, email)
    if (existing) {
      return NextResponse.json(
        { error: t('member_exists', { name: existing.full_name || email }), code: 'member_exists', user_id: existing.id, full_name: existing.full_name },
        { status: 409 }
      )
    }

    // Quota : règle unique (personne distincte, propriétaire non compté)
    const { ok, seats } = await checkTeamSeat(admin, account)
    if (!ok) {
      return NextResponse.json(
        { error: t('team_limit_reached', { plan: seats.planName, limit: seats.limit }), code: 'team_limit' },
        { status: 403 }
      )
    }

    // Read caller's locale from cookie so the invite link lands on the right language
    const locale = (request.headers.get('cookie') ?? '').match(/NEXT_LOCALE=([^;]+)/)?.[1] ?? 'fr'

    // Supabase invite uses IMPLICIT flow (hash tokens: #access_token=…&type=invite),
    // NOT PKCE. The server auth/callback never sees hash tokens (they aren't sent
    // in HTTP requests), so routing through /auth/callback is pointless — it always
    // falls through without setting a new session, leaving a stale cookie.
    //
    // Route DIRECTLY to reset-password. The client reads #access_token and calls
    // setSession() which is synchronous (writes to document.cookie, no network call),
    // replacing any stale session. type=invite in the hash sets the "invite" UI.
    const { data: { user }, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/${locale}/reset-password`,
      data: { full_name, role, shop_id },
    })

    if (inviteError) {
      // Adresse déjà utilisée par une personne d'un AUTRE compte StockShop
      if (/already.*(registered|exists)/i.test(inviteError.message)) {
        return NextResponse.json({ error: t('email_other_account'), code: 'email_other_account' }, { status: 409 })
      }
      return NextResponse.json({ error: inviteError.message }, { status: 400 })
    }

    if (!user) {
      return NextResponse.json({ error: t('create_user_error') }, { status: 500 })
    }

    // Create/update profile (service role bypasses RLS)
    const { error: profileError } = await admin.from('profiles').upsert({
      id: user.id,
      full_name,
      role,
      shop_id,
      is_active: true,
    })
    if (profileError) {
      console.error('Profile upsert error:', profileError)
      return NextResponse.json({ error: t('create_profile_error_prefix') + profileError.message }, { status: 500 })
    }

    // Create shop_members entry
    const { error: memberError } = await admin.from('shop_members').upsert({
      shop_id,
      user_id: user.id,
      role,
      is_active: true,
      can_delete_sales: false,
      invited_by: caller.id,
    }, { onConflict: 'shop_id,user_id' })
    if (memberError) {
      console.error('Shop member upsert error:', memberError)
    }

    await writeAuditLog({
      action: 'member.invite',
      shop_id,
      actor_id: caller.id,
      actor_email: caller.email,
      target_id: user.id,
      target_type: 'profile',
      metadata: { email, role, member_name: full_name },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
