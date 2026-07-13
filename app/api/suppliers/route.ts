import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

// Suppliers are a stock/procurement concern — same write roles as
// stock/inventory-count, excludes cashier and viewer.
const WRITE_ROLES = ['owner', 'manager', 'shop_manager', 'stock_manager', 'super_admin']

// POST /api/suppliers — create a supplier
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { shop_id, name, phone, city } = await request.json()
    if (!shop_id || !name) return NextResponse.json({ error: 'shop_id et name requis' }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !WRITE_ROLES.includes(role))
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

    const admin = await createAdminClient()
    const { data, error } = await (admin as any)
      .from('suppliers').insert({ shop_id, name, phone: phone || null, city: city || null }).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// PATCH /api/suppliers — update a supplier
export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { id, shop_id, name, phone, city } = await request.json()
    if (!id || !shop_id) return NextResponse.json({ error: 'id et shop_id requis' }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !WRITE_ROLES.includes(role))
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

    const admin = await createAdminClient()
    const { data, error } = await (admin as any)
      .from('suppliers')
      .update({ name, phone: phone || null, city: city || null })
      .eq('id', id).eq('shop_id', shop_id)
      .select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (!data) return NextResponse.json({ error: 'Fournisseur introuvable dans cette boutique' }, { status: 404 })

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/suppliers?id=&shop_id= — soft-delete, keeps a trace unlike a
// hard delete (matches customers' deleted_at pattern)
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

    const { data: supplier } = await (admin as any)
      .from('suppliers').select('name').eq('id', id).eq('shop_id', shopId).single()

    const { error } = await (admin as any)
      .from('suppliers').update({ deleted_at: new Date().toISOString() }).eq('id', id).eq('shop_id', shopId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    const { data: actorProfile } = await (admin as any).from('profiles').select('full_name').eq('id', user.id).single()
    await writeAuditLog({
      action: 'supplier.delete',
      shop_id: shopId,
      actor_id: user.id,
      actor_email: user.email,
      target_id: id,
      target_type: 'supplier',
      ip: getClientIp(request),
      metadata: {
        actor_name: actorProfile?.full_name || user.email,
        supplier_name: supplier?.name,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
