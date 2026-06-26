import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'

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
    // Record initial stock movement if product created with quantity > 0
    const initialQty = Number(body.quantity) || 0
    if (initialQty > 0 && data?.id) {
      await (admin as any).from('stock_movements').insert({
        shop_id: body.shop_id,
        product_id: data.id,
        type: 'in',
        quantity: initialQty,
        reason: 'Stock initial',
        performed_by: user.id,
        previous_qty: 0,
        new_qty: initialQty,
      })
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

// DELETE /api/products
// — Single:  ?id=xxx&shop_id=xxx           (owner/super_admin only, URL params)
// — Bulk:    body { ids: string[], shop_id } (owner/super_admin ou role delete_products)
// — All:     body { all: true, shop_id }    (owner/super_admin ou role delete_products)
export async function DELETE(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const singleId = searchParams.get('id')
    const singleShopId = searchParams.get('shop_id')

    // ── Suppression unitaire (comportement existant) ───────────────────────
    if (singleId && singleShopId) {
      const role = await checkShopRole(supabase, user.id, singleShopId)
      if (role !== 'owner' && role !== 'super_admin')
        return NextResponse.json({ error: 'Seul le propriétaire peut supprimer définitivement' }, { status: 403 })
      const admin = await createAdminClient()
      const { data: product } = await (admin as any)
        .from('products').select('id, name, sku, quantity, buying_price, selling_price').eq('id', singleId).single()
      if (product?.buying_price) {
        await (admin as any).from('sale_items')
          .update({ buying_price: Number(product.buying_price) })
          .eq('product_id', singleId).eq('buying_price', 0)
      }
      await (admin as any).from('products').update({ is_active: false }).eq('id', singleId)
      const { error } = await (admin as any).from('products').delete().eq('id', singleId)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })

      // Audit log
      const { data: actorProfile } = await (admin as any).from('profiles').select('full_name').eq('id', user.id).single()
      await (admin as any).from('audit_logs').insert({
        shop_id: singleShopId,
        actor_id: user.id,
        actor_email: user.email,
        action: 'delete_product',
        target_id: singleId,
        target_type: 'product',
        metadata: {
          actor_name: actorProfile?.full_name || user.email,
          product_name: product?.name,
          sku: product?.sku,
          quantity: product?.quantity,
          selling_price: product?.selling_price,
        },
      }).catch(() => {}) // non-blocking

      return NextResponse.json({ ok: true })
    }

    // ── Suppression en masse (ids[] ou all:true) ───────────────────────────
    let body: { shop_id?: string; ids?: string[]; all?: boolean } = {}
    try { body = await request.json() } catch {}
    if (!body.shop_id) return NextResponse.json({ error: 'shop_id requis' }, { status: 400 })

    // Vérification des permissions
    const role = await checkShopRole(supabase, user.id, body.shop_id)
    if (!role) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    const isPrivileged = role === 'owner' || role === 'super_admin'
    if (!isPrivileged) {
      const { data: shopData } = await (supabase as any)
        .from('shops').select('role_permissions').eq('id', body.shop_id).single()
      const canDelete = shopData?.role_permissions?.[role]?.delete_products ?? false
      if (!canDelete)
        return NextResponse.json({ error: 'Permission insuffisante pour supprimer des produits' }, { status: 403 })
    }

    const admin = await createAdminClient()

    // Résoudre les IDs à supprimer
    let ids: string[] = body.ids ?? []
    if (body.all) {
      const { data: allProds } = await (admin as any)
        .from('products').select('id').eq('shop_id', body.shop_id).eq('is_active', true)
      ids = (allProds ?? []).map((p: any) => p.id)
    }
    if (!ids.length) return NextResponse.json({ ok: true, deleted: 0 })

    // Geler les buying_price dans sale_items avant suppression (précision des rapports)
    const { data: prodsWithDetails } = await (admin as any)
      .from('products').select('id, name, sku, quantity, buying_price, selling_price').in('id', ids)
    if (prodsWithDetails?.length) {
      await Promise.all(
        prodsWithDetails
          .filter((p: any) => p.buying_price > 0)
          .map((p: any) =>
            (admin as any).from('sale_items')
              .update({ buying_price: Number(p.buying_price) })
              .eq('product_id', p.id).eq('buying_price', 0)
          )
      )
    }

    // Archive + suppression définitive
    await (admin as any).from('products').update({ is_active: false }).in('id', ids)
    const { error } = await (admin as any).from('products').delete().in('id', ids)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // Audit log
    const { data: actorProfile } = await (admin as any).from('profiles').select('full_name').eq('id', user.id).single()
    const action = body.all ? 'delete_all_products' : 'bulk_delete_products'
    const snapshot = (prodsWithDetails ?? []).slice(0, 10).map((p: any) => ({
      id: p.id, name: p.name, quantity: p.quantity,
    }))
    await (admin as any).from('audit_logs').insert({
      shop_id: body.shop_id,
      actor_id: user.id,
      actor_email: user.email,
      action,
      target_id: null,
      target_type: 'product',
      metadata: {
        actor_name: actorProfile?.full_name || user.email,
        count: ids.length,
        products_snapshot: snapshot,
      },
    }).catch(() => {}) // non-blocking

    return NextResponse.json({ ok: true, deleted: ids.length })
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
      previous_qty: current_quantity,
      new_qty: current_quantity + quantity_to_add,
    })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
