import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
      // Query profiles AND the user's shops in parallel.
      // The verify route updates both tables, but profiles can silently fail.
      // Using the later of the two expiries prevents a stale profiles row from
      // locking the owner out via the middleware billing redirect.
      const [profileRes, shopRes] = await Promise.all([
        supabase
          .from('profiles')
          .select('role, plan, plan_expires_at, trial_ends_at')
          .eq('id', user.id)
          .single(),
        supabase
          .from('shops')
          .select('plan, plan_expires_at, trial_ends_at')
          .eq('owner_id', user.id)
          .is('deleted_at', null)
          .order('plan_expires_at', { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
      ])

      const profile  = profileRes.data
      const shopBill = shopRes.data

      if (!role) role = profile?.role

      const profileExpiry = profile?.plan && profile.plan !== 'trial'
        ? (profile.plan_expires_at ?? null)
        : (profile?.trial_ends_at ?? null)

      const shopExpiry = shopBill?.plan && shopBill.plan !== 'trial'
        ? (shopBill.plan_expires_at ?? null)
        : (shopBill?.trial_ends_at ?? null)

      // Use whichever expiry is further in the future
      if (profileExpiry && shopExpiry) {
        planOkUntil = new Date(shopExpiry) > new Date(profileExpiry) ? shopExpiry : profileExpiry
      } else {
        planOkUntil = profileExpiry ?? shopExpiry ?? null
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

// DELETE — clear the role and plan cookies on sign-out
export async function DELETE() {
  const response = NextResponse.json({ success: true })
  response.cookies.set('user_role', '', { ...COOKIE_OPTS, maxAge: 0 })
  response.cookies.set('plan_ok_until', '', { ...COOKIE_OPTS, maxAge: 0 })
  return response
}
