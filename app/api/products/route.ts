import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

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

    const { data: actorProfile } = await (admin as any).from('profiles').select('full_name').eq('id', user.id).single()
    await writeAuditLog({
      action: 'create_product',
      shop_id: body.shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: data?.id,
      target_type: 'product',
      ip: getClientIp(request),
      metadata: {
        actor_name: actorProfile?.full_name || user.email,
        product_name: data?.name,
        selling_price: data?.selling_price,
        buying_price: data?.buying_price,
        quantity: data?.quantity,
      },
    })

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
    // Whitelist of fields a WRITE_ROLES member may update via PATCH.
    // Omitting a field from this set prevents privilege escalation (e.g. a
    // cashier sending is_active:false to soft-delete a product, or clearing
    // buying_price to distort profit reports).
    const PATCHABLE = new Set([
      'name', 'description', 'selling_price', 'buying_price', 'sku',
      'category_id', 'unit', 'image_url', 'low_stock_threshold', 'barcode',
      'supplier_name', 'supplier_id', 'promo_price', 'promo_until', 'promo_reason',
    ])
    const safeUpdates: Record<string, unknown> = Object.fromEntries(
      Object.entries(updates).filter(([k]) => PATCHABLE.has(k))
    )
    // is_active (archive/restore) is handled separately from PATCHABLE: it must
    // stay restricted to owner/super_admin even though cashier/stock_manager
    // are otherwise allowed to PATCH other product fields.
    const ARCHIVE_ROLES = ['owner', 'super_admin']
    const togglingActive = 'is_active' in updates
    if (togglingActive) {
      if (!ARCHIVE_ROLES.includes(role))
        return NextResponse.json({ error: 'Seul le propriétaire peut archiver ou restaurer un produit' }, { status: 403 })
      safeUpdates.is_active = Boolean(updates.is_active)
    }
    if (Object.keys(safeUpdates).length === 0)
      return NextResponse.json({ error: 'Aucun champ valide à mettre à jour' }, { status: 400 })
    if ('sku' in safeUpdates) safeUpdates.sku = (safeUpdates.sku as string)?.trim() || null
    const admin = await createAdminClient()

    // Snapshot avant modification, pour le journal d'audit
    const TRACKED_FIELDS = ['name', 'selling_price', 'buying_price', 'low_stock_threshold', 'sku', 'category_id', 'supplier_id'] as const
    const trackedChange = TRACKED_FIELDS.some(f => f in safeUpdates)
    let before: Record<string, unknown> | null = null
    if (trackedChange) {
      const { data: existing } = await (admin as any)
        .from('products').select(TRACKED_FIELDS.join(',')).eq('id', id).eq('shop_id', shop_id).single()
      before = existing || null
    }

    // shop_id filter prevents modifying a product that belongs to a different shop
    // even though the admin client bypasses RLS
    const { data, error } = await (admin as any).from('products').update(safeUpdates).eq('id', id).eq('shop_id', shop_id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (!data) return NextResponse.json({ error: 'Produit introuvable dans cette boutique' }, { status: 404 })

    if (trackedChange && before) {
      const changes: Record<string, { from: unknown; to: unknown }> = {}
      for (const f of TRACKED_FIELDS) {
        if (!(f in safeUpdates)) continue
        const from = before[f]
        const to = (data as any)[f]
        const same = (f === 'selling_price' || f === 'buying_price' || f === 'low_stock_threshold')
          ? Number(from) === Number(to)
          : (from ?? null) === (to ?? null)
        if (!same) changes[f] = { from: from ?? null, to: to ?? null }
      }

      // category_id/supplier_id are foreign keys — resolve to names for a
      // readable log entry (same reasoning as capturing product_name at
      // delete time, so the entry stays meaningful even if the category or
      // supplier is later renamed or removed).
      if (changes.category_id) {
        const ids = [changes.category_id.from, changes.category_id.to].filter(Boolean)
        const { data: cats } = ids.length
          ? await (admin as any).from('categories').select('id, name').in('id', ids)
          : { data: [] }
        const nameOf = (v: unknown) => (cats || []).find((c: any) => c.id === v)?.name ?? null
        changes.category_id = { from: nameOf(changes.category_id.from), to: nameOf(changes.category_id.to) }
      }
      if (changes.supplier_id) {
        const ids = [changes.supplier_id.from, changes.supplier_id.to].filter(Boolean)
        const { data: sups } = ids.length
          ? await (admin as any).from('suppliers').select('id, name').in('id', ids)
          : { data: [] }
        const nameOf = (v: unknown) => (sups || []).find((s: any) => s.id === v)?.name ?? null
        changes.supplier_id = { from: nameOf(changes.supplier_id.from), to: nameOf(changes.supplier_id.to) }
      }

      if (Object.keys(changes).length > 0) {
        const { data: actorProfile } = await (admin as any).from('profiles').select('full_name').eq('id', user.id).single()
        await writeAuditLog({
          action: 'update_product',
          shop_id,
          actor_id: user.id,
          actor_email: user.email,
          target_id: id,
          target_type: 'product',
          ip: getClientIp(request),
          metadata: {
            actor_name: actorProfile?.full_name || user.email,
            product_name: data.name || before.name,
            changes,
          },
        })
      }
    }

    if (togglingActive) {
      const { data: actorProfile } = await (admin as any).from('profiles').select('full_name').eq('id', user.id).single()
      await writeAuditLog({
        action: safeUpdates.is_active ? 'restore_product' : 'archive_product',
        shop_id,
        actor_id: user.id,
        actor_email: user.email,
        target_id: id,
        target_type: 'product',
        ip: getClientIp(request),
        metadata: {
          actor_name: actorProfile?.full_name || user.email,
          product_name: data.name,
        },
      })
    }

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
    const { product_id, shop_id, quantity_to_add, supplier_name, supplier_id, buying_price, expiry_date, notes, performed_by } = await request.json()
    if (!product_id || !shop_id) return NextResponse.json({ error: 'product_id et shop_id requis' }, { status: 400 })
    if (!Number.isFinite(Number(quantity_to_add)) || Number(quantity_to_add) <= 0)
      return NextResponse.json({ error: 'Quantité invalide' }, { status: 400 })
    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !WRITE_ROLES.includes(role))
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    const admin = await createAdminClient()

    // Read current quantity from DB — never trust the client value to avoid
    // lost-update race conditions when two restocks run concurrently or
    // when an offline sync flushes a stale quantity.
    const { data: product, error: fetchError } = await (admin as any)
      .from('products')
      .select('name, quantity, buying_price, shop_id')
      .eq('id', product_id)
      .eq('shop_id', shop_id)
      .single()
    if (fetchError || !product) return NextResponse.json({ error: 'Produit introuvable' }, { status: 404 })

    const prevQty = Number(product.quantity)
    const addQty  = Number(quantity_to_add)
    const newQty  = prevQty + addQty

    // A restock at a different price updates the product's cost — otherwise
    // the price entered in the restock form was silently discarded and
    // margin/reports kept using the old buying_price forever. The existing
    // stock and the newly received stock are pooled under one quantity, so
    // the resulting cost is a quantity-weighted average, not a straight
    // replacement — same logic as apply_purchase_order_receipt (migration 085).
    const enteredPrice = Number(buying_price) > 0 ? Number(buying_price) : null
    let newBuyingPrice: number | null = null
    const updatePayload: Record<string, unknown> = { quantity: newQty }
    if (enteredPrice !== null) {
      const prevPrice = Number(product.buying_price) || 0
      newBuyingPrice = Math.round(((prevQty * prevPrice + addQty * enteredPrice) / newQty) * 100) / 100
      updatePayload.buying_price = newBuyingPrice
    }

    // Optimistic lock: if quantity changed between our read and this update,
    // the .eq('quantity', prevQty) filter matches 0 rows → data is null → 409.
    const { data: updated, error: updateError } = await (admin as any)
      .from('products')
      .update(updatePayload)
      .eq('id', product_id)
      .eq('quantity', prevQty)
      .select('id')
      .single()
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 400 })
    if (!updated) return NextResponse.json({ error: 'Conflit de synchronisation — réessayez.' }, { status: 409 })

    await (admin as any).from('stock_movements').insert({
      shop_id,
      product_id,
      type: 'in',
      quantity: Number(quantity_to_add),
      reason: supplier_name ? `Restock from ${supplier_name}` : 'Restock',
      notes: notes || null,
      performed_by,
      previous_qty: prevQty,
      new_qty: newQty,
    })

    // New batch for this restock — carries its own cost and expiry date so
    // FEFO depletion at the sale trigger can tell it apart from stock
    // already on the shelf. Uses the price actually paid this time (not the
    // blended buying_price above), falling back to the product's current
    // cost when no price was entered for this restock.
    await (admin as any).from('product_batches').insert({
      shop_id,
      product_id,
      supplier_id: supplier_id || null,
      quantity: addQty,
      initial_quantity: addQty,
      buying_price: enteredPrice ?? (Number(product.buying_price) || 0),
      expiry_date: expiry_date || null,
      source: 'restock',
    })

    // Feed the supplier price comparator with what was actually paid — purely
    // informational (doesn't switch the product's current supplier, that
    // stays a deliberate choice via "Utiliser ce prix" on the Fournisseurs
    // page), so the comparison builds up from real purchases automatically.
    // Uses the price actually paid this time, not the blended buying_price.
    if (supplier_id && enteredPrice !== null) {
      await (admin as any)
        .from('product_supplier_prices')
        .upsert(
          { shop_id, product_id, supplier_id, price: enteredPrice, updated_at: new Date().toISOString() },
          { onConflict: 'product_id,supplier_id' }
        )
    }

    // Same audit trail as an edit-driven price change (PATCH above), so the
    // Journal shows every price change regardless of which flow caused it.
    if (newBuyingPrice !== null && Number(product.buying_price) !== newBuyingPrice) {
      const { data: actorProfile } = await (admin as any).from('profiles').select('full_name').eq('id', user.id).single()
      await writeAuditLog({
        action: 'update_product',
        shop_id,
        actor_id: user.id,
        actor_email: user.email,
        target_id: product_id,
        target_type: 'product',
        ip: getClientIp(request),
        metadata: {
          actor_name: actorProfile?.full_name || user.email,
          product_name: product.name,
          changes: { buying_price: { from: Number(product.buying_price), to: newBuyingPrice } },
        },
      })
    }

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
