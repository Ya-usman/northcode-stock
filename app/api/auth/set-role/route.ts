import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getCountry, detectCountryFromIso } from '@/lib/saas/countries'

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
}

// POST — look up the user's real role from DB and set it as HttpOnly cookie
export async function POST(request: Request) {
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { shop_id } = await request.json().catch(() => ({}))

    // Look up role from shop_members (source of truth)
    let query = supabase
      .from('shop_members')
      .select('role')
      .eq('user_id', user.id)
      .eq('is_active', true)

    if (shop_id) query = query.eq('shop_id', shop_id)

    const { data } = await query.order('created_at', { ascending: true }).limit(1).single()

    // Fallback: check profiles table (also fetches plan info for billing cookie)
    let role = data?.role
    let planOkUntil: string | null = null
    {
      // profiles is the single source of truth for billing (owner-level —
      // see migration 047 and lib/saas/resolve-owner-plan.ts). shops no
      // longer carries its own copy, so there's nothing left to compare.
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, plan, plan_expires_at, trial_ends_at, is_internal')
        .eq('id', user.id)
        .single()

      if (!role) role = profile?.role

      planOkUntil = profile?.plan && profile.plan !== 'trial'
        ? (profile.plan_expires_at ?? null)
        : (profile?.trial_ends_at ?? null)

      // Compte interne (superadmin de test) — jamais bloqué par le mur de
      // facturation.
      if (profile?.is_internal) {
        planOkUntil = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString()
      }
    }

    if (!role) {
      // No shop_members row AND no profile — this account was created by
      // Supabase Auth directly (Google/Apple sign-in on the login page acts
      // as an implicit sign-up for a never-before-seen account) without ever
      // going through /api/register's shop+profile+membership provisioning,
      // which only runs for the manual email/password form. Left alone, this
      // user is permanently stuck: GET /profiles 406s forever (0 rows, not a
      // timing issue) and the client's profile-fetch retry loop can never
      // succeed since nothing was ever going to create the row — confirmed
      // live via a real user's Supabase logs, then verified directly against
      // the DB (no profiles/shop_members row for their auth id at all).
      // Auto-provision a starter shop here, mirroring /api/register, so a
      // first-time OAuth sign-in ends up in a working trial account instead
      // of an orphaned auth user.
      const admin = await createAdminClient() as any
      const meta = user.user_metadata as any
      const fullName: string = meta?.full_name || meta?.name || user.email?.split('@')[0] || 'Utilisateur'
      // x-user-country : transmis par /auth/callback depuis la géoloc IP de la requête
      // OAuth d'origine. x-vercel-ip-country : présent directement quand cette route est
      // appelée depuis le navigateur (login page, app-layout) plutôt qu'en interne.
      const isoCountry = request.headers.get('x-user-country') || request.headers.get('x-vercel-ip-country')
      const countryConfig = getCountry(detectCountryFromIso(isoCountry))
      const trialEndsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

      const { data: newShop, error: shopError } = await admin
        .from('shops')
        .insert({
          name: `Boutique de ${fullName}`,
          owner_id: user.id,
          city: '',
          state: '',
          currency: countryConfig.currencySymbol,
          country: countryConfig.code,
          billing_country: countryConfig.code,
        })
        .select('id')
        .single()

      if (!shopError && newShop) {
        const { error: profileError } = await admin.from('profiles').upsert({
          id: user.id,
          shop_id: newShop.id,
          full_name: fullName,
          role: 'owner',
          is_active: true,
          country: countryConfig.code,
          plan: 'trial',
          trial_ends_at: trialEndsAt,
          plan_expires_at: null,
        })
        if (!profileError) {
          const { error: memberError } = await admin.from('shop_members').insert({
            shop_id: newShop.id,
            user_id: user.id,
            role: 'owner',
            is_active: true,
          })
          if (!memberError) role = 'owner'
          else await admin.from('shops').delete().eq('id', newShop.id)
        } else {
          await admin.from('shops').delete().eq('id', newShop.id)
        }
      }
    }

    if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 })

    const response = NextResponse.json({ success: true, role })
    response.cookies.set('user_role', role, { ...COOKIE_OPTS, maxAge: 3600 })
    // Refreshed on every login/shop switch — lets middleware block without a DB call
    response.cookies.set('plan_ok_until', planOkUntil ?? '', { ...COOKIE_OPTS, maxAge: 86400 })
    return response
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE — clear role, plan, and Supabase session cookies on sign-out
export async function DELETE() {
  const cookieStore = cookies()
  const response = NextResponse.json({ success: true })
  response.cookies.set('user_role', '', { ...COOKIE_OPTS, maxAge: 0 })
  response.cookies.set('plan_ok_until', '', { ...COOKIE_OPTS, maxAge: 0 })

  // Also clear the Supabase auth token cookie so the middleware stops treating
  // the browser as authenticated after a client-side sign-out.
  // The client-side auth.signOut() only clears localStorage — not HTTP cookies.
  cookieStore.getAll().forEach(c => {
    if (c.name.startsWith('sb-') && c.name.includes('-auth-token') && !c.name.includes('verifier')) {
      response.cookies.set(c.name, '', { path: '/', maxAge: 0, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' })
    }
  })

  return response
}
