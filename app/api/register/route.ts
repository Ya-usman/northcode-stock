import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getCountry } from '@/lib/saas/countries'

export async function POST(request: Request) {
  try {
    const { user_id, full_name, email, shop_name, city, phone, country } = await request.json()

    if (!user_id || !full_name || !shop_name || !city) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 })
    }

    const countryConfig = getCountry(country || 'NG')
    const supabase = await createAdminClient() as any

    // Wait for auth.users row to be committed (free-tier race condition)
    let userConfirmed = false
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: authUser } = await supabase.auth.admin.getUserById(user_id)
      if (authUser?.user?.id) { userConfirmed = true; break }
      await new Promise(r => setTimeout(r, 800 + attempt * 400))
    }
    if (!userConfirmed) {
      return NextResponse.json({ error: 'Compte utilisateur non encore disponible, veuillez réessayer.' }, { status: 503 })
    }

    // Create shop
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .insert({
        name: shop_name,
        owner_id: user_id,
        city,
        state: city,
        whatsapp: phone || null,
        currency: countryConfig.currencySymbol,
        country: countryConfig.code,
        plan: 'trial',
        trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select('id')
      .single()

    if (shopError || !shop) {
      return NextResponse.json({ error: shopError?.message || 'Erreur création boutique' }, { status: 500 })
    }

    // Create owner profile
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: user_id,
        shop_id: shop.id,
        full_name,
        role: 'owner',
        is_active: true,
      })

    if (profileError) {
      // Rollback shop
      await supabase.from('shops').delete().eq('id', shop.id)
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    // Add owner to shop_members
    await supabase.from('shop_members').upsert({
      shop_id: shop.id,
      user_id,
      role: 'owner',
      is_active: true,
    }, { onConflict: 'shop_id,user_id' })

    return NextResponse.json({ success: true, shop_id: shop.id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
