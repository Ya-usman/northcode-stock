import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

async function getAuthedUser() {
  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return { user, supabase }
}

// POST /api/products — create a product
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const body = await request.json()
    const { shop_id } = body
    if (!shop_id) return NextResponse.json({ error: 'shop_id requis' }, { status: 400 })

    // Verify user has access to this shop and has the right role
    const { data: member } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    let role = member?.role
    if (!role) {
      // Fallback: check profiles for legacy accounts
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, shop_id')
        .eq('id', user.id)
        .single()
      if (profile?.shop_id === shop_id) role = profile.role
    }

    if (!role || !['owner', 'stock_manager', 'super_admin'].includes(role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const admin = await createAdminClient()
    const { data, error } = await (admin as any).from('products').insert(body).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// PATCH /api/products — update a product
export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { id, shop_id, ...updates } = await request.json()
    if (!id || !shop_id) return NextResponse.json({ error: 'id et shop_id requis' }, { status: 400 })

    const { data: member } = await supabase
      .from('shop_members')
      .select('role')
      .eq('shop_id', shop_id)
      .eq('user_id', user.id)
      .eq('is_active', true)
      .single()

    let role = member?.role
    if (!role) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, shop_id')
        .eq('id', user.id)
        .single()
      if (profile?.shop_id === shop_id) role = profile.role
    }

    if (!role || !['owner', 'stock_manager', 'super_admin'].includes(role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const admin = await createAdminClient()
    const { data, error } = await (admin as any).from('products').update(updates).eq('id', id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
