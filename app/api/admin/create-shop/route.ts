import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getCountry } from '@/lib/saas/countries'

const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim())

// POST /api/admin/create-shop
// Creates user (if not exists) + shop + profile + shop_member in one shot
export async function POST(request: Request) {
  try {
    // Auth check
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { session } } = await supabase.auth.getSession()
    const caller = session?.user
    if (!caller) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { data: callerProfile } = await supabase.from('profiles').select('role').eq('id', caller.id).single()
    const isSuperAdmin = SUPER_ADMIN_EMAILS.includes(caller.email || '') || callerProfile?.role === 'super_admin'
    if (!isSuperAdmin) return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })

    const { owner_email, owner_name, shop_name, city, country = 'NG', temp_password } = await request.json()
    if (!owner_email || !owner_name || !shop_name || !city) {
      return NextResponse.json({ error: 'Champs requis: owner_email, owner_name, shop_name, city' }, { status: 400 })
    }

    const admin = await createAdminClient() as any
    const countryConfig = getCountry(country)

    // 1. Find or create auth user
    let userId: string
    const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const existing = users?.find((u: any) => u.email === owner_email)

    if (existing) {
      userId = existing.id
    } else {
      // Create new auth user — they'll get an invite/reset email to set their password
      const password = temp_password || Math.random().toString(36).slice(-10) + 'A1!'
      const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
        email: owner_email,
        password,
        email_confirm: true,
        user_metadata: { full_name: owner_name },
      })
      if (createErr || !newUser?.user) throw createErr || new Error('Erreur création utilisateur')
      userId = newUser.user.id
    }

    // 2. Create shop
    const { data: shop, error: shopErr } = await admin.from('shops').insert({
      name: shop_name,
      owner_id: userId,
      city,
      state: city,
      currency: countryConfig.currencySymbol,
      country: countryConfig.code,
      plan: 'trial',
      trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      low_stock_threshold: 10,
      tax_rate: 0,
    }).select('id').single()

    if (shopErr || !shop) throw shopErr || new Error('Erreur création boutique')

    // 3. Upsert profile
    await admin.from('profiles').upsert({
      id: userId,
      shop_id: shop.id,
      full_name: owner_name,
      role: 'owner',
      is_active: true,
    }, { onConflict: 'id' })

    // 4. Add to shop_members
    await admin.from('shop_members').upsert({
      shop_id: shop.id,
      user_id: userId,
      role: 'owner',
      is_active: true,
    }, { onConflict: 'shop_id,user_id' })

    return NextResponse.json({
      success: true,
      shop_id: shop.id,
      user_id: userId,
      user_created: !existing,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
