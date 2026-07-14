import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

const WRITE_ROLES = ['owner', 'manager', 'shop_manager', 'stock_manager', 'super_admin']

// POST /api/purchase-orders/receive — verify received quantities and restock
// in one atomic transaction (apply_purchase_order_receipt), instead of a
// blind status flip followed by a separate manual restock.
// body: { shop_id, purchase_order_id, items: [{item_id, product_id, quantity_received, unit_price, expiry_date, receipt_note}], payment_amount?, payment_method? }
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { shop_id, purchase_order_id, items, payment_amount, payment_method } = await request.json()
    if (!shop_id || !purchase_order_id) return NextResponse.json({ error: 'shop_id et purchase_order_id requis' }, { status: 400 })
    if (!Array.isArray(items) || items.length === 0)
      return NextResponse.json({ error: 'Au moins une ligne est requise' }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !WRITE_ROLES.includes(role))
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

    const admin = await createAdminClient()

    const { data: po } = await (admin as any)
      .from('purchase_orders').select('supplier_id').eq('id', purchase_order_id).eq('shop_id', shop_id).single()
    if (!po) return NextResponse.json({ error: 'Bon de commande introuvable' }, { status: 404 })

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
    if (po.supplier_id) {
      for (const it of items) {
        if (!it.product_id || !it.unit_price || Number(it.unit_price) <= 0) continue
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
    if (payment_amount && Number(payment_amount) > 0) {
      const { data: freshPo } = await (admin as any)
        .from('purchase_orders').select('balance').eq('id', purchase_order_id).single()
      const applied = Math.min(Number(payment_amount), Number(freshPo?.balance) || 0)
      if (applied > 0) {
        await (admin as any).from('supplier_payments').insert({
          purchase_order_id,
          amount: applied,
          method: payment_method || 'cash',
          paid_by: user.id,
        })
      }
    }

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
