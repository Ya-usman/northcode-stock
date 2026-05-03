import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function POST(request: Request) {
  try {
    const { name, city } = await request.json()

    if (!name?.trim()) {
      return NextResponse.json({ error: 'Nom requis' }, { status: 400 })
    }

    // Get current user
    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    // Get user's current shop for defaults
    const { data: profile } = await supabase.from('profiles').select('shop_id').eq('id', user.id).single()

    let currency = 'NGN', country = 'NG'
    if (profile?.shop_id) {
      const { data: currentShop } = await supabase.from('shops').select('currency, country').eq('id', profile.shop_id).single()
      if (currentShop) {
        currency = (currentShop as any).currency ?? 'NGN'
        country = (currentShop as any).country ?? 'NG'
      }
    }

    // Use admin client to bypass RLS
    const admin = await createAdminClient()

    const { data: shop, error: shopError } = await admin.from('shops').insert({
      name: name.trim(),
      city: city?.trim() || '',
      state: '',
      owner_id: user.id,
      plan: 'trial',
      trial_ends_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      currency,
      country,
      low_stock_threshold: 10,
      tax_rate: 0,
    } as any).select().single()

    if (shopError || !shop) {
      return NextResponse.json({ error: shopError?.message ?? 'Erreur création' }, { status: 500 })
    }

    const { error: memberError } = await admin.from('shop_members').insert({
      shop_id: (shop as any).id,
      user_id: user.id,
      role: 'owner',
    } as any)

    if (memberError) {
      // Rollback shop if member insert fails
      await admin.from('shops').delete().eq('id', (shop as any).id)
      return NextResponse.json({ error: memberError.message }, { status: 500 })
    }

    return NextResponse.json({ shop })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
