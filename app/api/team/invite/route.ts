import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getPlan } from '@/lib/saas/plans'
import { validateBody, uuid, email as emailSchema, shortText, roleEnum } from '@/lib/api/validate'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'
import { z } from 'zod'

const inviteSchema = z.object({
  email: emailSchema,
  full_name: shortText,
  role: roleEnum,
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

export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    // Verify caller is authenticated and is an owner of the target shop
    const supabase = await createServerClient() as any
    const { data: { user: caller } } = await supabase.auth.getUser()

    if (!caller) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const body = await request.json()
    const validated = validateBody(inviteSchema, body)
    if ('error' in validated) return validated.error
    const { email, full_name, role, shop_id, invited_by } = validated.data

    // Only owners and super_admins can invite
    const { data: callerMember } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', caller.id)
      .eq('is_active', true)
      .single()

    if (!callerMember || !['owner', 'manager', 'shop_manager', 'super_admin'].includes(callerMember.role)) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }

    // Enforce team member limit based on owner plan — billing is owner-level
    // (profiles is the single source of truth, see migration 047).
    const { data: shopRow } = await supabase.from('shops').select('owner_id').eq('id', shop_id).single()
    const { data: ownerProfile } = (shopRow as any)?.owner_id
      ? await supabase.from('profiles').select('plan, plan_expires_at').eq('id', (shopRow as any).owner_id).single()
      : { data: null }
    const plan = getPlan((ownerProfile as any)?.plan)
    if (plan.limits.team_members !== -1) {
      // Count active non-owner members
      const { count: memberCount } = await supabase
        .from('shop_members').select('id', { count: 'exact', head: true })
        .eq('shop_id', shop_id).eq('is_active', true).neq('role', 'owner')
      if ((memberCount ?? 0) >= plan.limits.team_members) {
        return NextResponse.json(
          { error: t('team_limit_reached', { plan: plan.name, limit: plan.limits.team_members }) },
          { status: 403 }
        )
      }
    }

    const admin = getAdminClient()

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
      invited_by: invited_by || null,
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
      metadata: { email, role },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
