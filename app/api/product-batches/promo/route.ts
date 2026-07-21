import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { hasRolePermission } from '@/lib/api/role-permissions'

// Same permission as /api/products' promo fields — stock/pricing concern.
// cashier is trusted unconditionally there too (see STOCK_ALWAYS_ALLOW).
const PROMO_ALWAYS_ALLOW = ['stock_manager', 'cashier']

// PATCH /api/product-batches/promo — set or clear a promo on one specific
// batch. Deliberately a dedicated route rather than a direct client update:
// product_batches' UPDATE RLS is open to any shop member (needed for the
// FEFO depletion trigger on sale), so a role check has to live here instead.
// body: { id, shop_id, promo_price, promo_until } — pass both null to clear.
export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { id, shop_id, promo_price, promo_until } = await request.json()
    if (!id || !shop_id) return NextResponse.json({ error: 'id et shop_id requis' }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !(await hasRolePermission(supabase, role, shop_id, 'stock', { alwaysAllow: PROMO_ALWAYS_ALLOW })))
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

    if (promo_price !== null && (!Number.isFinite(Number(promo_price)) || Number(promo_price) <= 0))
      return NextResponse.json({ error: 'Prix promo invalide' }, { status: 400 })

    const admin = await createAdminClient() as any
    const { data, error } = await admin
      .from('product_batches')
      .update({ promo_price: promo_price ?? null, promo_until: promo_until ?? null })
      .eq('id', id)
      .eq('shop_id', shop_id)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (!data) return NextResponse.json({ error: 'Lot introuvable' }, { status: 404 })

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
