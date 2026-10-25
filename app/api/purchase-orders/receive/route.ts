import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { canViewCost, canWriteFeature } from '@/lib/api/role-permissions'
import { costVisible } from '@/lib/api/cost-fields'
import { canPaySupplierDebt } from '@/lib/api/supplier-access'
import { getApiTranslator } from '@/lib/api/i18n'
import { productsOutsideShop } from '@/lib/api/shop-objects'

// POST /api/purchase-orders/receive — verify received quantities and restock
// in one atomic transaction (apply_purchase_order_receipt), instead of a
// blind status flip followed by a separate manual restock.
// body: { shop_id, purchase_order_id, items: [{item_id, product_id, quantity_received, unit_price, expiry_date, receipt_note}], payment_amount?, payment_full?, payment_method? }
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { shop_id, purchase_order_id, items: sentItems, payment_amount, payment_method, payment_full } = await request.json()
    let items = sentItems
    if (!shop_id || !purchase_order_id) return NextResponse.json({ error: t('shop_po_id_required') }, { status: 400 })
    if (!Array.isArray(items) || items.length === 0)
      return NextResponse.json({ error: t('at_least_one_line_required') }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !(await canWriteFeature(supabase, role, shop_id, 'suppliers')))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient()

    const { data: po } = await (admin as any)
      .from('purchase_orders').select('supplier_id, is_opening_balance').eq('id', purchase_order_id).eq('shop_id', shop_id).single()
    if (!po) return NextResponse.json({ error: t('po_not_found') }, { status: 404 })
    if (po.is_opening_balance) return NextResponse.json({ error: t('opening_not_editable') }, { status: 400 })

    // Paiement déclaré à la réception = paiement d'une dette fournisseur : droit « payer » (Crédits en modification ET
    // Fournisseurs en lecture), vérifié AVANT toute écriture. La réception « à crédit » reste ouverte.
    const wantsPayment = payment_full === true || (Number(payment_amount) > 0)
    if (wantsPayment && !(await canPaySupplierDebt(supabase, role, shop_id)))
      return NextResponse.json({ error: t('po_payment_forbidden'), code: 'supplier_payment_forbidden' }, { status: 403 })

    // Sans le droit au coût (view_purchase_cost) : aucun prix venu de l'appareil n'est cru. Chaque ligne reprend le
    // prix DÉJÀ connu sur le bon ; une ligne reçue sans prix sur le bon NI coût connu du produit attend une personne
    // autorisée (jamais de prix saisi à l'aveugle, jamais de coût 0 inventé).
    const seesCost = await canViewCost(supabase, role, shop_id)
    if (!seesCost) {
      const { data: lines } = await (admin as any)
        .from('purchase_order_items').select('id, product_id, unit_price').eq('purchase_order_id', purchase_order_id)
      const known = new Map<string, { product_id: string | null; unit_price: number | null }>((lines || []).map((l: any) => [l.id, l]))
      items = items.map((it: any) => ({ ...it, unit_price: known.get(it?.item_id)?.unit_price ?? null }))
      const unpriced = items.filter((it: any) => Number(it.quantity_received) > 0 && !(Number(it.unit_price) > 0) && known.get(it.item_id)?.product_id)
      if (unpriced.length) {
        const ids = unpriced.map((it: any) => known.get(it.item_id)!.product_id)
        const { data: prods } = await (admin as any).from('products').select('id, buying_price').in('id', ids).eq('shop_id', shop_id)
        const costed = new Set((prods || []).filter((p: any) => Number(p.buying_price) > 0).map((p: any) => p.id))
        if (ids.some((id: string) => !costed.has(id)))
          return NextResponse.json({ error: t('po_price_required'), code: 'purchase_order_price_required' }, { status: 409 })
      }
    }

    const { data, error } = await (admin as any).rpc('apply_purchase_order_receipt', {
      p_shop_id: shop_id,
      p_po_id: purchase_order_id,
      p_performed_by: user.id,
      p_items: items,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    const { data: actorProfile } = await (admin as any).from('profiles').select('full_name').eq('id', user.id).single()

    // Trace permanente de la réception — action la plus engageante du
    // cycle (stock + argent), indépendante de la ligne purchase_orders.
    await writeAuditLog({
      action: 'purchase_order.receive',
      shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: purchase_order_id,
      target_type: 'purchase_order',
      ip: getClientIp(request),
      metadata: { actor_name: actorProfile?.full_name || user.email },
    })

    const changedItems = (data?.items || []).filter((it: any) => Number(it.price_from) !== Number(it.price_to))
    if (changedItems.length > 0) {
      for (const it of changedItems) {
        await writeAuditLog({
          action: 'update_product',
          shop_id,
          actor_id: user.id,
          actor_email: user.email,
          target_id: it.product_id,
          target_type: 'product',
          ip: getClientIp(request),
          metadata: {
            actor_name: actorProfile?.full_name || user.email,
            product_name: it.product_name,
            changes: { buying_price: { from: Number(it.price_from), to: Number(it.price_to) } },
          },
        })
      }
    }

    // Feed the supplier price comparator — same as a manual restock.
    // Seulement les produits de la boutique du bon (la réception elle-même ignore déjà les autres en base)
    if (po.supplier_id) {
      const outside = new Set(await productsOutsideShop(admin, items.map((it: any) => it?.product_id), shop_id))
      for (const it of items) {
        if (!it.product_id || outside.has(it.product_id) || !it.unit_price || Number(it.unit_price) <= 0) continue
        await (admin as any)
          .from('product_supplier_prices')
          .upsert(
            { shop_id, product_id: it.product_id, supplier_id: po.supplier_id, price: Number(it.unit_price), updated_at: new Date().toISOString() },
            { onConflict: 'product_id,supplier_id' }
          )
      }
    }

    // Paiement déclaré au moment de la réception (comptant/partiel) — insère
    // directement dans supplier_payments, le trigger after_supplier_payment_insert
    // (migration 093) se charge d'ajuster amount_paid/payment_status/
    // suppliers.total_owed. Rien à faire si "à crédit" (payment_amount absent).
    if (payment_full === true || (payment_amount && Number(payment_amount) > 0)) {
      const { data: freshPo } = await (admin as any)
        .from('purchase_orders').select('balance').eq('id', purchase_order_id).single()
      // « Payé en totalité » : le montant est celui du bon, calculé ici (l'appareil sans droit au coût ne le connaît pas)
      const applied = payment_full === true ? (Number(freshPo?.balance) || 0) : Math.min(Number(payment_amount), Number(freshPo?.balance) || 0)
      if (applied > 0) {
        await (admin as any).from('supplier_payments').insert({
          purchase_order_id,
          amount: applied,
          method: payment_method || 'cash',
          paid_by: user.id,
        })
      }
    }

    // data.items[].price_from / price_to = ancien et nouveau prix d'achat : seulement avec le droit au coût
    return NextResponse.json({ data: costVisible(data, seesCost) })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
