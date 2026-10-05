import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getPlan } from '@/lib/saas/plans'
import { getShopLimit } from '@/lib/saas/team-quota'
import { getApiTranslator } from '@/lib/api/i18n'
import { getOwnerShopIds } from '@/lib/api/shop-auth'
import { validateShopIdentity, isShopCodeTaken } from '@/lib/saas/shop-identity'

export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const body = await request.json()
    const { name, city, country: requestCountry } = body

    if (!name?.trim()) {
      return NextResponse.json({ error: t('name_required') }, { status: 400 })
    }

    // Champs d'identité facultatifs (migration 152)
    const identity = validateShopIdentity(body)
    const identityError = Object.values(identity.errors)[0]
    if (identityError) return NextResponse.json({ error: t(identityError as any), field: Object.keys(identity.errors)[0] }, { status: 400 })

    // Get current user
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    // Seul un propriétaire crée des boutiques (refonte du 5 oct. 2026) : un
    // employé (Manager, Responsable, Caissier…) qui n'est propriétaire
    // d'aucune boutique ne peut pas en créer. Un nouveau compte (aucune
    // affectation) garde la possibilité de créer sa première boutique.
    const { data: myMemberships } = await supabase
      .from('shop_members').select('role').eq('user_id', user.id).eq('is_active', true)
    if ((myMemberships || []).length > 0 && !(myMemberships || []).some((m: any) => m.role === 'owner')) {
      return NextResponse.json({ error: t('owner_only_shops') }, { status: 403 })
    }

    // Profil du propriétaire : pays par défaut de la nouvelle boutique
    const { data: profile } = await supabase
      .from('profiles')
      .select('shop_id, country')
      .eq('id', user.id)
      .single()

    const { currencyCodeForCountry } = await import('@/lib/saas/currencies')

    // If the owner explicitly chose a country, use it; otherwise inherit from profile/primary shop.
    // `currency` = code ISO (V3), toujours dérivé du pays.
    let country: string
    if (requestCountry) {
      country = requestCountry
    } else if ((profile as any)?.country) {
      country = (profile as any).country
    } else if (profile?.shop_id) {
      const { data: primaryShop } = await supabase.from('shops').select('country').eq('id', profile.shop_id).single()
      country = (primaryShop as any)?.country ?? 'NG'
    } else {
      country = 'NG'
    }
    const currency = currencyCodeForCountry(country)

    // Formule de l'ENTREPRISE du propriétaire (migration 153) — source unique
    const { data: ownEntity } = await supabase.from('entities').select('id, plan').eq('owner_user_id', user.id).order('created_at', { ascending: true }).limit(1).maybeSingle()
    const refPlan: string = (ownEntity as any)?.plan ?? 'trial'

    // La nouvelle boutique rejoint l'entreprise du propriétaire (trigger
    // shops_assign_entity, migration 153) et partage son abonnement : rien à
    // écrire ici (ni double facturation, ni essai séparé).
    const admin = await createAdminClient()

    // Limite de boutiques = formule + boutiques offertes (gestes commerciaux)
    const plan = getPlan(refPlan)
    const shopLimit = (ownEntity as any)?.id
      ? (await getShopLimit(admin, { entityId: (ownEntity as any).id, plan: refPlan })).limit
      : plan.limits.shops
    if (shopLimit !== -1) {
      const { count } = await supabase
        .from('shop_members').select('id', { count: 'exact', head: true })
        .eq('user_id', user.id).eq('role', 'owner').eq('is_active', true)
      if ((count ?? 0) >= shopLimit) {
        return NextResponse.json(
          { error: t('shop_limit_reached', { plan: plan.name, limit: shopLimit }) },
          { status: 403 }
        )
      }
    }

    // Code boutique unique dans le compte
    if (identity.values.code) {
      const ownerShopIds = await getOwnerShopIds(admin, user.id)
      if (await isShopCodeTaken(admin, ownerShopIds, identity.values.code)) {
        return NextResponse.json({ error: t('shop_code_taken'), field: 'code' }, { status: 409 })
      }
    }
    // Seules les valeurs renseignées sont envoyées : une création sans ces
    // champs reste possible même avant l'application de la migration 152.
    const identityValues = Object.fromEntries(Object.entries(identity.values).filter(([, v]) => v))

    const { data: shop, error: shopError } = await admin.from('shops').insert({
      ...identityValues,
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
      if ((shopError as any)?.code === '23505') return NextResponse.json({ error: t('shop_code_taken'), field: 'code' }, { status: 409 })
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
