import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'

// Same write roles as /api/suppliers — stock/procurement concern.
const WRITE_ROLES = ['owner', 'manager', 'shop_manager', 'stock_manager', 'super_admin']

// GET /api/product-supplier-prices?shop_id= — raw price comparison entries;
// joined against product/supplier names client-side (already in memory there).
export async function GET(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const shopId = searchParams.get('shop_id')
    if (!shopId) return NextResponse.json({ error: 'shop_id requis' }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shopId)
    if (!role) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

    const admin = await createAdminClient()
    const { data, error } = await (admin as any)
      .from('product_supplier_prices')
      .select('id, product_id, supplier_id, price, updated_at')
      .eq('shop_id', shopId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ data: data || [] })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/product-supplier-prices — create or update a price entry
// body: { shop_id, product_id, supplier_id, price }
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { shop_id, product_id, supplier_id, price } = await request.json()
    if (!shop_id || !product_id || !supplier_id || !price)
      return NextResponse.json({ error: 'shop_id, product_id, supplier_id et price requis' }, { status: 400 })
    if (Number(price) <= 0)
      return NextResponse.json({ error: 'Le prix doit être supérieur à 0' }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !WRITE_ROLES.includes(role))
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

    const admin = await createAdminClient()
    const { data, error } = await (admin as any)
      .from('product_supplier_prices')
      .upsert(
        { shop_id, product_id, supplier_id, price: Number(price), updated_at: new Date().toISOString() },
        { onConflict: 'product_id,supplier_id' }
      )
      .select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/product-supplier-prices?id=&shop_id= — remove a comparison entry
export async function DELETE(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const shopId = searchParams.get('shop_id')
    if (!id || !shopId) return NextResponse.json({ error: 'id et shop_id requis' }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shopId)
    if (!role || !WRITE_ROLES.includes(role))
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

    const admin = await createAdminClient()
    const { error } = await (admin as any)
      .from('product_supplier_prices').delete().eq('id', id).eq('shop_id', shopId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
