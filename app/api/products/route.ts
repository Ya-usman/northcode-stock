import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

async function getAuthedUser() {
  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { session: _sess } } = await supabase.auth.getSession()
    const user = _sess?.user ?? null
  return { user, supabase }
}

async function checkShopRole(supabase: any, userId: string, shopId: string) {
  const { data: member } = await supabase
    .from('shop_members').select('role')
    .eq('shop_id', shopId).eq('user_id', userId).eq('is_active', true).single()
  if (member?.role) return member.role
  const { data: profile } = await supabase
    .from('profiles').select('role, shop_id').eq('id', userId).single()
  if (profile?.role === 'super_admin') return 'super_admin'
  if (profile?.shop_id === shopId) return profile.role
  return null
}

const WRITE_ROLES = ['owner', 'stock_manager', 'super_admin', 'cashier']

// POST /api/products — create a product
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    const body = await request.json()
    const { shop_id } = body
    if (!shop_id) return NextResponse.json({ error: 'shop_id requis' }, { status: 400 })
    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !WRITE_ROLES.includes(role))
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    // Always null-ify empty SKU to avoid unique constraint on empty strings
    body.sku = body.sku?.trim() || null
    const admin = await createAdminClient()
    const { data, error } = await (admin as any).from('products').insert(body).select().single()
    if (error) {
      const msg = error.message?.includes('product_sku_shop_unique') || error.message?.includes('sku')
        ? 'Ce SKU est déjà utilisé par un autre produit. Laissez le champ vide ou choisissez un SKU différent.'
        : error.message
      return NextResponse.json({ error: msg }, { status: 400 })
    }
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// PATCH /api/products — update a product
export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    const { id, shop_id, ...updates } = await request.json()
    if (!id || !shop_id) return NextResponse.json({ error: 'id et shop_id requis' }, { status: 400 })
    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !WRITE_ROLES.includes(role))
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    if ('sku' in updates) updates.sku = updates.sku?.trim() || null
    const admin = await createAdminClient()
    const { data, error } = await (admin as any).from('products').update(updates).eq('id', id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// PUT /api/products — restock (update quantity + insert stock_movement)
export async function PUT(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    const { product_id, shop_id, current_quantity, quantity_to_add, supplier_name, buying_price, notes, performed_by } = await request.json()
    if (!product_id || !shop_id) return NextResponse.json({ error: 'product_id et shop_id requis' }, { status: 400 })
    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !WRITE_ROLES.includes(role))
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    const admin = await createAdminClient()
    const { error: updateError } = await (admin as any).from('products')
      .update({ quantity: current_quantity + quantity_to_add })
      .eq('id', product_id)
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 400 })
    await (admin as any).from('stock_movements').insert({
      shop_id,
      product_id,
      type: 'in',
      quantity: quantity_to_add,
      reason: supplier_name ? `Restock from ${supplier_name}` : 'Restock',
      notes: notes || null,
      performed_by,
    })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
