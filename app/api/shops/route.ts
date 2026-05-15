import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getPlan, hasActiveSubscription } from '@/lib/saas/plans'

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

    // Get owner profile: country + owner-level plan (single source of truth)
    const { data: profile } = await supabase
      .from('profiles')
      .select('shop_id, country, plan, plan_expires_at, trial_ends_at')
      .eq('id', user.id)
      .single()

    let country = (profile as any)?.country ?? null
    let currency = 'NGN'

    if (!country && profile?.shop_id) {
      const { data: primaryShop } = await supabase.from('shops').select('currency, country').eq('id', profile.shop_id).single()
      country = (primaryShop as any)?.country ?? 'NG'
      currency = (primaryShop as any)?.currency ?? 'NGN'
    } else {
      const { getCountry } = await import('@/lib/saas/countries')
      currency = getCountry(country).currencySymbol
    }

    // Read plan from owner profile (owner-level billing)
    // Fallback to scanning all shops for pre-migration accounts without profiles.plan
    let refPlan: string = (profile as any)?.plan ?? null
    let refExpiry: string | null = (profile as any)?.plan_expires_at ?? null
    let refTrial: string | null = (profile as any)?.trial_ends_at ?? null

    if (!refPlan) {
      const { data: ownerShops } = await supabase
        .from('shops')
        .select('id, plan, plan_expires_at, trial_ends_at')
        .eq('owner_id', user.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: true })
      const best = (ownerShops ?? []).find(s => hasActiveSubscription(s.plan, s.plan_expires_at))
        ?? (ownerShops ?? [])[0] ?? null
      refPlan = (best as any)?.plan ?? 'trial'
      refExpiry = (best as any)?.plan_expires_at ?? null
      refTrial = (best as any)?.trial_ends_at ?? null
    }

    // Enforce shop limit based on owner's plan
    const plan = getPlan(refPlan)
    if (plan.limits.shops !== -1) {
      const { count } = await supabase
        .from('shop_members').select('id', { count: 'exact', head: true })
        .eq('user_id', user.id).eq('role', 'owner').eq('is_active', true)
      if ((count ?? 0) >= plan.limits.shops) {
        return NextResponse.json(
          { error: `Votre forfait ${plan.name} est limité à ${plan.limits.shops} boutique(s). Passez au forfait supérieur pour en créer davantage.` },
          { status: 403 }
        )
      }
    }

    // New shop inherits owner's paid plan — no double billing
    const isActiveSub = hasActiveSubscription(refPlan, refExpiry)

    const newShopPlan = isActiveSub ? refPlan : 'trial'
    const newShopExpiry = isActiveSub ? refExpiry : null
    const newShopTrial = isActiveSub
      ? null
      : (refTrial ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString())

    // Use admin client to bypass RLS
    const admin = await createAdminClient()

    const { data: shop, error: shopError } = await admin.from('shops').insert({
      name: name.trim(),
      city: city?.trim() || '',
      state: '',
      owner_id: user.id,
      plan: newShopPlan,
      plan_expires_at: newShopExpiry,
      trial_ends_at: newShopTrial,
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
