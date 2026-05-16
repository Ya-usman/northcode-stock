import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createClient as createServerClient } from '@/lib/supabase/server'
import { getPlan } from '@/lib/saas/plans'
import { validateBody, uuid, email as emailSchema, shortText, roleEnum } from '@/lib/api/validate'
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
  try {
    // Verify caller is authenticated and is an owner of the target shop
    const supabase = await createServerClient() as any
    const { data: { user: caller } } = await supabase.auth.getUser()
    
    if (!caller) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

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

    if (!callerMember || !['owner', 'super_admin'].includes(callerMember.role)) {
      return NextResponse.json({ error: 'Permission refusée' }, { status: 403 })
    }

    // Enforce team member limit based on shop plan
    const { data: shopRow } = await supabase
      .from('shops').select('plan, plan_expires_at').eq('id', shop_id).single()
    const plan = getPlan((shopRow as any)?.plan)
    if (plan.limits.team_members !== -1) {
      // Count active non-owner members
      const { count: memberCount } = await supabase
        .from('shop_members').select('id', { count: 'exact', head: true })
        .eq('shop_id', shop_id).eq('is_active', true).neq('role', 'owner')
      if ((memberCount ?? 0) >= plan.limits.team_members) {
        return NextResponse.json(
          { error: `Votre forfait ${plan.name} est limité à ${plan.limits.team_members} employé(s). Passez au forfait supérieur pour en ajouter davantage.` },
          { status: 403 }
        )
      }
    }

    const admin = getAdminClient()

    // Invite user via Supabase Auth Admin
    const { data: { user }, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/fr/reset-password`,
      data: { full_name, role, shop_id },
    })

    if (inviteError) {
      return NextResponse.json({ error: inviteError.message }, { status: 400 })
    }

    if (!user) {
      return NextResponse.json({ error: 'Erreur création utilisateur' }, { status: 500 })
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
      return NextResponse.json({ error: 'Erreur création profil: ' + profileError.message }, { status: 500 })
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

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
