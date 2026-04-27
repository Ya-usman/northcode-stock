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
    const supabase = await createClient()
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

    // Fallback: check profiles table
    let role = data?.role
    if (!role) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single()
      role = profile?.role
    }

    if (!role) return NextResponse.json({ error: 'Role not found' }, { status: 404 })

    const response = NextResponse.json({ success: true, role })
    response.cookies.set('user_role', role, { ...COOKIE_OPTS, maxAge: 3600 })
    return response
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// DELETE — clear the role cookie on sign-out
export async function DELETE() {
  const response = NextResponse.json({ success: true })
  response.cookies.set('user_role', '', { ...COOKIE_OPTS, maxAge: 0 })
  return response
}
