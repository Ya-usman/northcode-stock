import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { canViewCost, canViewFeature, canWriteFeature } from '@/lib/api/role-permissions'
import { orderForViewer, canViewSupplierDebt } from '@/lib/api/supplier-access'
import { getApiTranslator } from '@/lib/api/i18n'
import { supplierOfShop, productsOutsideShop } from '@/lib/api/shop-objects'
import {
  checkPoStatusTransition, poTransitionErrorKey, updatePoStatusAtomically, PO_TRANSITION_NOT_ALLOWED, PO_STATUS_CHANGED,
} from '@/lib/api/purchase-order-status'

// Purchase orders live inside the Suppliers page/tab client-side (gated by
// canAccess('suppliers') — there's no dedicated toggle wired up for them),
// so they honor the same role_permissions.suppliers setting server-side.
async function canWritePurchaseOrders(supabase: any, role: string, shop_id: string): Promise<boolean> {
  return canWriteFeature(supabase, role, shop_id, 'suppliers')
}

async function nextReference(admin: any, shopId: string): Promise<string> {
  const year = new Date().getFullYear()
  const yearStart = `${year}-01-01T00:00:00`
  const { count } = await admin
    .from('purchase_orders')
    .select('id', { count: 'exact', head: true })
    .eq('shop_id', shopId)
    .eq('is_opening_balance', false) // les reprises (REP-F-…) ont leur propre numérotation
    .gte('created_at', yearStart)
  const seq = (count ?? 0) + 1
  return `BC-${year}-${String(seq).padStart(4, '0')}`
}

// GET /api/purchase-orders?shop_id= | ?shop_ids=a,b — list purchase orders with their items
// Une boutique (shop_id) ou le contexte « Toutes les boutiques » (shop_ids) : seules les boutiques dont la personne
// est membre ET où elle peut voir « Fournisseurs » comptent ; les coûts sont décidés boutique par boutique.
// Droit : voir « Fournisseurs » dans la boutique. Sans le droit de voir les coûts, un bon garde ses lignes (ce qui
// est commandé et reçu) mais ni prix unitaires ni montants — ils ne sont pas envoyés (lib/api/supplier-access).
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const requested = (searchParams.get('shop_ids') ?? searchParams.get('shop_id') ?? '').split(',').map(x => x.trim()).filter(x => /^[0-9a-f-]{36}$/i.test(x))
    if (!requested.length) return NextResponse.json({ error: t('shop_id_required') }, { status: 400 })
    const allowed: string[] = []
    const costShops = new Set<string>()
    const debtShops = new Set<string>() // payé / solde / statut : droit dette (Crédits + Fournisseurs en lecture)
    for (const id of Array.from(new Set(requested))) {
      const role = await checkShopRole(supabase, user.id, id)
      if (!role || !(await canViewFeature(supabase, role, id, 'suppliers'))) continue
      allowed.push(id)
      if (await canViewCost(supabase, role, id)) costShops.add(id)
      if (await canViewSupplierDebt(supabase, role, id)) debtShops.add(id)
    }
    if (!allowed.length) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient()
    const { data, error } = await (admin as any)
      .from('purchase_orders')
      .select('*, purchase_order_items(*), suppliers(name, phone, email, city)')
      .in('shop_id', allowed)
      .eq('is_opening_balance', false) // reprises de dette : dans Crédits, pas des bons de commande
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

    // Montants d'un bon : seulement si la personne peut voir les coûts dans SA boutique
    const out = enriched.map((po: any) => orderForViewer(po, { cost: costShops.has(po.shop_id), debt: debtShops.has(po.shop_id) }))
    return NextResponse.json({ data: out, cost: allowed.every(id => costShops.has(id)) })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/purchase-orders — create a draft purchase order
// body: { shop_id, supplier_id, items: [{product_id, product_name, unit, quantity_ordered, unit_price}], notes, expected_delivery_date }
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { shop_id, supplier_id, items, notes, expected_delivery_date } = await request.json()
    if (!shop_id || !supplier_id) return NextResponse.json({ error: t('shop_supplier_ids_required') }, { status: 400 })
    if (!Array.isArray(items) || items.length === 0)
      return NextResponse.json({ error: t('at_least_one_product_required') }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !(await canWritePurchaseOrders(supabase, role, shop_id)))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient()
    // Le fournisseur et les produits doivent appartenir à la boutique du bon (jamais une autre boutique / entreprise)
    if (!(await supplierOfShop(admin, supplier_id, shop_id))) return NextResponse.json({ error: t('po_supplier_wrong_shop'), field: 'supplier_id' }, { status: 400 })
    if ((await productsOutsideShop(admin, items.map((it: any) => it?.product_id), shop_id)).length)
      return NextResponse.json({ error: t('po_product_wrong_shop') }, { status: 400 })
    const reference = await nextReference(admin, shop_id)
    // Prix des lignes = prix d'achat : seulement avec le droit au coût (view_purchase_cost). Sans lui, le bon est créé
    // SANS prix (une personne autorisée les complète) — jamais un prix saisi à l'aveugle.
    const seesCost = await canViewCost(supabase, role, shop_id)

    const { data: po, error: poError } = await (admin as any)
      .from('purchase_orders')
      .insert({
        shop_id, supplier_id, reference, status: 'draft',
        notes: notes || null,
        expected_delivery_date: expected_delivery_date || null,
        created_by: user.id,
      })
      .select().single()
    if (poError) return NextResponse.json({ error: poError.message }, { status: 400 })

    const itemRows = items.map((it: any) => ({
      purchase_order_id: po.id,
      product_id: it.product_id || null,
      product_name: it.product_name,
      unit: it.unit || null,
      quantity_ordered: Number(it.quantity_ordered),
      unit_price: seesCost && it.unit_price != null ? Number(it.unit_price) : null,
    }))
    const { error: itemsError } = await (admin as any).from('purchase_order_items').insert(itemRows)
    if (itemsError) {
      await (admin as any).from('purchase_orders').delete().eq('id', po.id)
      return NextResponse.json({ error: itemsError.message }, { status: 400 })
    }

    const created = { ...po, purchase_order_items: itemRows }
    return NextResponse.json({ data: orderForViewer(created, { cost: seesCost, debt: await canViewSupplierDebt(supabase, role, shop_id) }) })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// PATCH /api/purchase-orders — change status, or replace items while still a draft
// body: { id, shop_id, status?, items? }
// Statut : seuls brouillon → envoyé, brouillon → annulé, envoyé → annulé (409 purchase_order_status_transition_not_allowed
// sinon) ; « reçu » / « partiel » uniquement par /api/purchase-orders/receive. Écriture conditionnée au statut lu
// (409 purchase_order_status_changed si le bon a changé entre-temps). Même statut : rien n'est écrit.
export async function PATCH(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { id, shop_id, status, items } = await request.json()
    if (!id || !shop_id) return NextResponse.json({ error: t('id_shop_id_required') }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !(await canWritePurchaseOrders(supabase, role, shop_id)))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient()

    const { data: existing, error: fetchError } = await (admin as any)
      .from('purchase_orders').select('status, reference, supplier_id, is_opening_balance').eq('id', id).eq('shop_id', shop_id).single()
    if (fetchError || !existing) return NextResponse.json({ error: t('po_not_found') }, { status: 404 })
    if (existing.is_opening_balance) return NextResponse.json({ error: t('opening_not_editable') }, { status: 400 })

    // Statut : matrice fermée, vérifiée AVANT toute écriture (lib/api/purchase-order-status)
    const transition = status ? checkPoStatusTransition(existing.status, status) : null
    if (transition?.kind === 'unknown_status')
      return NextResponse.json({ error: t('invalid_status') }, { status: 400 })
    if (transition?.kind === 'not_allowed')
      return NextResponse.json(
        { error: t(poTransitionErrorKey(transition.reason) as any), code: PO_TRANSITION_NOT_ALLOWED, reason: transition.reason },
        { status: 409 }
      )
    if (transition?.kind === 'allowed' && Array.isArray(items))
      return NextResponse.json({ error: t('po_items_or_status') }, { status: 400 })

    if (transition?.kind === 'allowed') {
      const now = new Date().toISOString()
      const updates: Record<string, unknown> = { status, updated_at: now }
      if (status === 'sent') { updates.sent_at = now; updates.sent_by = user.id }
      if (status === 'cancelled') updates.cancelled_by = user.id

      // UPDATE … WHERE id AND shop_id AND status = <statut lu> : 0 ligne si le bon a changé entre-temps
      const result = await updatePoStatusAtomically(admin, { id, shopId: shop_id, from: existing.status, updates })
      if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 })
      if (result.conflict)
        return NextResponse.json({ error: t('po_status_changed'), code: PO_STATUS_CHANGED }, { status: 409 })

      // Trace permanente d'une annulation ou d'un envoi — même raisonnement
      // que la suppression d'un brouillon : indépendante de la ligne elle-même.
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
      return NextResponse.json({ data: result.data })
    }

    if (Array.isArray(items)) {
      if (existing.status !== 'draft')
        return NextResponse.json({ error: t('draft_only_editable') }, { status: 400 })
      // Lignes : uniquement des produits de la boutique du bon (vérifié AVANT de remplacer les lignes)
      if ((await productsOutsideShop(admin, items.map((it: any) => it?.product_id), shop_id)).length)
        return NextResponse.json({ error: t('po_product_wrong_shop') }, { status: 400 })
      // Sans le droit au coût : les prix déjà posés (par une personne autorisée) sont CONSERVÉS par produit — l'appareil
      // ne les a pas reçus et ne doit ni les effacer ni les remplacer.
      const seesCost = await canViewCost(supabase, role, shop_id)
      const keptPrice = new Map<string, number | null>()
      if (!seesCost) {
        const { data: oldLines } = await (admin as any).from('purchase_order_items').select('product_id, unit_price').eq('purchase_order_id', id)
        for (const l of oldLines || []) if (l.product_id) keptPrice.set(l.product_id, l.unit_price ?? null)
      }
      await (admin as any).from('purchase_order_items').delete().eq('purchase_order_id', id)
      const itemRows = items.map((it: any) => ({
        purchase_order_id: id,
        product_id: it.product_id || null,
        product_name: it.product_name,
        unit: it.unit || null,
        quantity_ordered: Number(it.quantity_ordered),
        unit_price: seesCost
          ? (it.unit_price != null ? Number(it.unit_price) : null)
          : (it.product_id ? keptPrice.get(it.product_id) ?? null : null),
      }))
      const { error: itemsError } = await (admin as any).from('purchase_order_items').insert(itemRows)
      if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 400 })

      const { data, error } = await (admin as any)
        .from('purchase_orders').update({ updated_at: new Date().toISOString() }).eq('id', id).eq('shop_id', shop_id).select().single()
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ data: orderForViewer(data, { cost: seesCost, debt: await canViewSupplierDebt(supabase, role, shop_id) }) })
    }

    // Même statut (ou rien à changer) : aucune écriture, aucune trace — le bon est renvoyé tel quel (sans montants)
    return NextResponse.json({ data: { id, shop_id, status: existing.status, reference: existing.reference }, unchanged: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/purchase-orders?id=&shop_id= — draft only, keeps a trace otherwise
export async function DELETE(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    const shopId = searchParams.get('shop_id')
    if (!id || !shopId) return NextResponse.json({ error: t('id_shop_id_required') }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shopId)
    if (!role || !(await canWritePurchaseOrders(supabase, role, shopId)))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient()
    const { data: existing } = await (admin as any)
      .from('purchase_orders').select('status, reference, supplier_id, total_amount').eq('id', id).eq('shop_id', shopId).single()
    if (!existing) return NextResponse.json({ error: t('po_not_found') }, { status: 404 })
    if (existing.status !== 'draft')
      return NextResponse.json({ error: t('draft_only_deletable') }, { status: 400 })

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
