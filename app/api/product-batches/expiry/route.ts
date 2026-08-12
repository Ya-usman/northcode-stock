import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { hasRolePermission } from '@/lib/api/role-permissions'

// Same permission tier as /api/product-batches/promo — stock/pricing concern,
// same table. cashier trusted unconditionally (see STOCK_ALWAYS_ALLOW).
const EXPIRY_ALWAYS_ALLOW = ['stock_manager', 'cashier']

// PATCH /api/product-batches/expiry — correct or clear a batch's expiry
// date (e.g. it was set by mistake on a product that doesn't expire).
// Dedicated route for the same reason as .../promo: product_batches' UPDATE
// RLS is open to any shop member (needed for the FEFO depletion trigger on
// sale), so the role check has to live here instead.
// body: { id, shop_id, expiry_date } — expiry_date: 'YYYY-MM-DD' or null to clear.
export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { id, shop_id, expiry_date } = await request.json()
    if (!id || !shop_id) return NextResponse.json({ error: 'id et shop_id requis' }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !(await hasRolePermission(supabase, role, shop_id, 'stock', { alwaysAllow: EXPIRY_ALWAYS_ALLOW })))
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

    if (expiry_date !== null && isNaN(new Date(expiry_date).getTime()))
      return NextResponse.json({ error: 'Date invalide' }, { status: 400 })

    const admin = await createAdminClient() as any
    const { data, error } = await admin
      .from('product_batches')
      .update({ expiry_date: expiry_date ?? null })
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
