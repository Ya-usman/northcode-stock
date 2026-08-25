import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getPlan } from '@/lib/saas/plans'
import { getApiTranslator } from '@/lib/api/i18n'

export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { name, city, country: requestCountry } = await request.json()

    if (!name?.trim()) {
      return NextResponse.json({ error: t('name_required') }, { status: 400 })
    }

    // Get current user
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    // Get owner profile: country + owner-level plan (single source of truth)
    const { data: profile } = await supabase
      .from('profiles')
      .select('shop_id, country, plan, plan_expires_at, trial_ends_at')
      .eq('id', user.id)
      .single()

    const { getCountry } = await import('@/lib/saas/countries')

    // If the owner explicitly chose a country, use it; otherwise inherit from profile/primary shop
    let country: string
    let currency: string
    if (requestCountry) {
      country = requestCountry
      currency = getCountry(requestCountry).currencySymbol
    } else if ((profile as any)?.country) {
      country = (profile as any).country
      currency = getCountry(country).currencySymbol
    } else if (profile?.shop_id) {
      const { data: primaryShop } = await supabase.from('shops').select('currency, country').eq('id', profile.shop_id).single()
      country = (primaryShop as any)?.country ?? 'NG'
      currency = (primaryShop as any)?.currency ?? '₦'
    } else {
      country = 'NG'
      currency = '₦'
    }

    // Read plan from owner profile — the single source of truth for billing
    // (profiles.plan has a DB DEFAULT 'trial', always populated).
    const refPlan: string = (profile as any)?.plan ?? 'trial'

    // Enforce shop limit based on owner's plan
    const plan = getPlan(refPlan)
    if (plan.limits.shops !== -1) {
      const { count } = await supabase
        .from('shop_members').select('id', { count: 'exact', head: true })
        .eq('user_id', user.id).eq('role', 'owner').eq('is_active', true)
      if ((count ?? 0) >= plan.limits.shops) {
        return NextResponse.json(
          { error: t('shop_limit_reached', { plan: plan.name, limit: plan.limits.shops }) },
          { status: 403 }
        )
      }
    }

    // New shop automatically inherits the owner's plan — plan is resolved
    // from profiles via the owner, not stored per-shop, so there is nothing
    // to set here (no double billing, no separate trial to track).
    const admin = await createAdminClient()

    const { data: shop, error: shopError } = await admin.from('shops').insert({
      name: name.trim(),
      city: city?.trim() || '',
      state: '',
      owner_id: user.id,
      currency,
      country,
      billing_country: country,
      low_stock_threshold: 10,
      tax_rate: 0,
    } as any).select().single()

    if (shopError || !shop) {
      return NextResponse.json({ error: shopError?.message ?? t('create_error') }, { status: 500 })
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
