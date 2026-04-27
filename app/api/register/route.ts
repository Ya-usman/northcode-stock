import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getCountry } from '@/lib/saas/countries'

export async function POST(request: Request) {
  try {
    const { user_id, full_name, email, shop_name, city, phone, country } = await request.json()

    if (!user_id || !full_name || !shop_name || !city) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 })
    }

    // Verify the user_id exists in Supabase Auth using the admin client
    const supabase = await createAdminClient()
    const { data: { user: authUser }, error: authError } = await supabase.auth.admin.getUserById(user_id)
    if (authError || !authUser) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const countryConfig = getCountry(country || 'NG')

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
      } as any)
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
      } as any)

    if (profileError) {
      await supabase.from('shops').delete().eq('id', shop.id)
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    // Create shop_members entry so RLS lets the owner read their own shop
    const { error: memberError } = await supabase
      .from('shop_members')
      .insert({
        shop_id: shop.id,
        user_id,
        role: 'owner',
        is_active: true,
      } as any)

    if (memberError) {
      await supabase.from('shops').delete().eq('id', shop.id)
      return NextResponse.json({ error: memberError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, shop_id: shop.id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
