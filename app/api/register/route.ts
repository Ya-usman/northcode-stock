import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  try {
    const { user_id, full_name, email, shop_name, city, phone } = await request.json()

    if (!user_id || !full_name || !shop_name || !city) {
      return NextResponse.json({ error: 'Champs manquants' }, { status: 400 })
    }

    const supabase = await createAdminClient()

    // Create shop
    const { data: shop, error: shopError } = await supabase
      .from('shops')
      .insert({
        name: shop_name,
        owner_id: user_id,
        city,
        state: city,
        whatsapp: phone || null,
        currency: '₦',
        plan: 'free',
        trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
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
      // Rollback shop
      await supabase.from('shops').delete().eq('id', shop.id)
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, shop_id: shop.id })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
