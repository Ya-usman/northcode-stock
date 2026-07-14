import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

// Purchase orders are a stock/procurement concern — same write roles as
// /api/suppliers and stock/inventory-count.
const WRITE_ROLES = ['owner', 'manager', 'shop_manager', 'stock_manager', 'super_admin']

async function nextReference(admin: any, shopId: string): Promise<string> {
  const year = new Date().getFullYear()
  const yearStart = `${year}-01-01T00:00:00`
  const { count } = await admin
    .from('purchase_orders')
    .select('id', { count: 'exact', head: true })
    .eq('shop_id', shopId)
    .gte('created_at', yearStart)
  const seq = (count ?? 0) + 1
  return `BC-${year}-${String(seq).padStart(4, '0')}`
}

// GET /api/purchase-orders?shop_id= — list purchase orders with their items
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
      .from('purchase_orders')
      .select('*, purchase_order_items(*), suppliers(name, phone, email, city)')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // Résout created_by/sent_by/cancelled_by en noms affichables — même
    // pattern que /api/stock/movements (les colonnes référencent auth.users,
    // pas profiles, donc pas de jointure PostgREST directe possible).
    const actorIds = Array.from(new Set(
      (data || []).flatMap((po: any) => [po.created_by, po.sent_by, po.cancelled_by, po.received_by]).filter(Boolean)
    )) as string[]
    let actorMap: Record<string, string> = {}
    if (actorIds.length) {
      const { data: profiles } = await (admin as any).from('profiles').select('id, full_name').in('id', actorIds)
      for (const p of (profiles || [])) actorMap[p.id] = p.full_name
    }
    const enriched = (data || []).map((po: any) => ({
      ...po,
      created_by_name: po.created_by ? (actorMap[po.created_by] || null) : null,
      sent_by_name: po.sent_by ? (actorMap[po.sent_by] || null) : null,
      cancelled_by_name: po.cancelled_by ? (actorMap[po.cancelled_by] || null) : null,
      received_by_name: po.received_by ? (actorMap[po.received_by] || null) : null,
    }))

    return NextResponse.json({ data: enriched })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/purchase-orders — create a draft purchase order
// body: { shop_id, supplier_id, items: [{product_id, product_name, unit, quantity_ordered, unit_price}], notes }
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { shop_id, supplier_id, items, notes } = await request.json()
    if (!shop_id || !supplier_id) return NextResponse.json({ error: 'shop_id et supplier_id requis' }, { status: 400 })
    if (!Array.isArray(items) || items.length === 0)
      return NextResponse.json({ error: 'Au moins un produit est requis' }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !WRITE_ROLES.includes(role))
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

    const admin = await createAdminClient()
    const reference = await nextReference(admin, shop_id)

    const { data: po, error: poError } = await (admin as any)
      .from('purchase_orders')
      .insert({ shop_id, supplier_id, reference, status: 'draft', notes: notes || null, created_by: user.id })
      .select().single()
    if (poError) return NextResponse.json({ error: poError.message }, { status: 400 })

    const itemRows = items.map((it: any) => ({
      purchase_order_id: po.id,
      product_id: it.product_id || null,
      product_name: it.product_name,
      unit: it.unit || null,
      quantity_ordered: Number(it.quantity_ordered),
      unit_price: it.unit_price != null ? Number(it.unit_price) : null,
    }))
    const { error: itemsError } = await (admin as any).from('purchase_order_items').insert(itemRows)
    if (itemsError) {
      await (admin as any).from('purchase_orders').delete().eq('id', po.id)
      return NextResponse.json({ error: itemsError.message }, { status: 400 })
    }

    return NextResponse.json({ data: { ...po, purchase_order_items: itemRows } })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// PATCH /api/purchase-orders — change status, or replace items while still a draft
// body: { id, shop_id, status?, items? }
export async function PATCH(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { id, shop_id, status, items } = await request.json()
    if (!id || !shop_id) return NextResponse.json({ error: 'id et shop_id requis' }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !WRITE_ROLES.includes(role))
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

    const admin = await createAdminClient()

    const { data: existing, error: fetchError } = await (admin as any)
      .from('purchase_orders').select('status, reference, supplier_id').eq('id', id).eq('shop_id', shop_id).single()
    if (fetchError || !existing) return NextResponse.json({ error: 'Bon de commande introuvable' }, { status: 404 })

    if (Array.isArray(items)) {
      if (existing.status !== 'draft')
        return NextResponse.json({ error: 'Seul un brouillon peut être modifié' }, { status: 400 })
      await (admin as any).from('purchase_order_items').delete().eq('purchase_order_id', id)
      const itemRows = items.map((it: any) => ({
        purchase_order_id: id,
        product_id: it.product_id || null,
        product_name: it.product_name,
        unit: it.unit || null,
        quantity_ordered: Number(it.quantity_ordered),
        unit_price: it.unit_price != null ? Number(it.unit_price) : null,
      }))
      const { error: itemsError } = await (admin as any).from('purchase_order_items').insert(itemRows)
      if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 400 })
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (status) {
      if (!['draft', 'sent', 'received', 'cancelled'].includes(status))
        return NextResponse.json({ error: 'Statut invalide' }, { status: 400 })
      updates.status = status
      if (status === 'sent') { updates.sent_at = new Date().toISOString(); updates.sent_by = user.id }
      if (status === 'received') updates.received_at = new Date().toISOString()
      if (status === 'cancelled') updates.cancelled_by = user.id
    }

    const { data, error } = await (admin as any)
      .from('purchase_orders').update(updates).eq('id', id).eq('shop_id', shop_id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // Trace permanente d'une annulation ou d'un envoi — même raisonnement
    // que la suppression d'un brouillon : indépendante de la ligne elle-même.
    if (status === 'cancelled' || status === 'sent') {
      const { data: actorProfile } = await (admin as any).from('profiles').select('full_name').eq('id', user.id).single()
      await writeAuditLog({
        action: status === 'cancelled' ? 'purchase_order.cancel' : 'purchase_order.send',
        shop_id,
        actor_id: user.id,
        actor_email: user.email,
        target_id: id,
        target_type: 'purchase_order',
        ip: getClientIp(request),
        metadata: { actor_name: actorProfile?.full_name || user.email, reference: existing.reference },
      })
    }

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/purchase-orders?id=&shop_id= — draft only, keeps a trace otherwise
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
    const { data: existing } = await (admin as any)
      .from('purchase_orders').select('status, reference, supplier_id, total_amount').eq('id', id).eq('shop_id', shopId).single()
    if (!existing) return NextResponse.json({ error: 'Bon de commande introuvable' }, { status: 404 })
    if (existing.status !== 'draft')
      return NextResponse.json({ error: 'Seul un brouillon peut être supprimé' }, { status: 400 })

    const { count: itemsCount } = await (admin as any)
      .from('purchase_order_items').select('id', { count: 'exact', head: true }).eq('purchase_order_id', id)

    const { error } = await (admin as any).from('purchase_orders').delete().eq('id', id).eq('shop_id', shopId)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // Un brouillon supprimé ne laisse plus aucune ligne en base — la seule
    // trace restante est ce journal d'audit, écrit après coup (snapshot).
    const { data: actorProfile } = await (admin as any).from('profiles').select('full_name').eq('id', user.id).single()
    await writeAuditLog({
      action: 'purchase_order.delete',
      shop_id: shopId,
      actor_id: user.id,
      actor_email: user.email,
      target_id: id,
      target_type: 'purchase_order',
      ip: getClientIp(request),
      metadata: {
        actor_name: actorProfile?.full_name || user.email,
        reference: existing.reference,
        supplier_id: existing.supplier_id,
        items_count: itemsCount ?? 0,
        total_amount: existing.total_amount,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
