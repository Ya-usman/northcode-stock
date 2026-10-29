import { NextResponse } from 'next/server'
import { canViewCost, canViewFeature, canWriteFeature } from '@/lib/api/role-permissions'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { getApiTranslator } from '@/lib/api/i18n'
import { isUuid, loadAllocations, loadNames, transferError, transferWorkflowAvailable } from '@/lib/api/transfers'

/** Droits de la personne sur les deux boutiques RÉELLES du transfert (jamais celles envoyées par le navigateur) */
async function rightsOn(supabase: any, userId: string, shopIds: string[]) {
  const out: Record<string, { view: boolean; write: boolean; cost: boolean }> = {}
  for (const id of shopIds) {
    const role = await checkShopRole(supabase, userId, id)
    out[id] = role
      ? { view: await canViewFeature(supabase, role, id, 'transfers'), write: await canWriteFeature(supabase, role, id, 'transfers'), cost: await canViewCost(supabase, role, id) }
      : { view: false, write: false, cost: false }
  }
  return out
}

// GET /api/stock-transfers/[id] — détail : lignes (photo, code-barres, quantités, écart), lots (péremption, date
// d'entrée, lot d'arrivée), historique, et ce que la personne peut faire. Coût seulement avec le droit de voir les
// coûts. Droit « Transferts » en lecture dans la source OU la destination.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    if (!isUuid(params.id)) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })

    const admin = await createAdminClient() as any
    const { data: tr } = await admin.from('stock_transfers').select('*, stock_transfer_items(*)').eq('id', params.id).maybeSingle()
    if (!tr) return NextResponse.json({ error: t('transfer_not_found') }, { status: 404 })
    const rights = await rightsOn(supabase, user.id, [tr.source_shop_id, tr.destination_shop_id])
    const src = rights[tr.source_shop_id], dst = rights[tr.destination_shop_id]
    if (!src.view && !dst.view) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    const showCost = src.cost || dst.cost

    const workflow = await transferWorkflowAvailable(admin)
    const items = (tr.stock_transfer_items || []) as any[]
    const allocations = workflow ? await loadAllocations(admin, [tr.id], () => showCost) : {}
    const productIds = items.flatMap(it => [it.source_product_id, it.destination_product_id]).filter(Boolean)
    const destBatchIds = Object.values(allocations).flat().map(a => a.destination_batch_id).filter(Boolean)
    const [{ data: products }, { data: destBatches }, { data: shops }, { data: logs }] = await Promise.all([
      productIds.length ? admin.from('products').select('id, name, sku, image_url, unit, is_active').in('id', productIds) : Promise.resolve({ data: [] }),
      destBatchIds.length ? admin.from('product_batches').select('id, quantity, expiry_date, received_at').in('id', destBatchIds) : Promise.resolve({ data: [] }),
      admin.from('shops').select('id, name, currency').in('id', [tr.source_shop_id, tr.destination_shop_id]),
      admin.from('audit_logs').select('action, actor_id, created_at, metadata').eq('target_id', tr.id).eq('target_type', 'stock_transfer').order('created_at'),
    ])
    const productMap = Object.fromEntries(((products || []) as any[]).map(p => [p.id, p]))
    const batchMap = Object.fromEntries(((destBatches || []) as any[]).map(b => [b.id, b]))
    const shopMap = Object.fromEntries(((shops || []) as any[]).map(s => [s.id, s]))
    const names = await loadNames(admin, [tr.created_by, tr.sent_by, tr.received_by, tr.cancelled_by, ...((logs || []) as any[]).map(l => l.actor_id)])

    const lines = items.map(it => {
      const src = productMap[it.source_product_id] || null
      const dest = productMap[it.destination_product_id] || null
      const { buying_price, ...rest } = it
      return {
        ...rest,
        ...(showCost ? { buying_price } : {}),
        image_url: src?.image_url ?? dest?.image_url ?? null,
        sku: src?.sku ?? dest?.sku ?? null,
        destination_product_name: dest?.name ?? null,
        destination_product_active: dest ? dest.is_active !== false : null,
        lots: (allocations[it.id] || []).map(a => ({ ...a, destination_batch: a.destination_batch_id ? batchMap[a.destination_batch_id] || null : null })),
      }
    })
    // Historique : colonnes du transfert (toujours présentes) + journal (actions, écarts)
    const history = [
      { event: 'created', at: tr.created_at, by: names[tr.created_by] || null },
      ...(tr.status !== 'draft' && (tr.sent_at || tr.created_at) ? [{ event: 'sent', at: tr.sent_at || tr.created_at, by: names[tr.sent_by ?? tr.created_by] || null }] : []),
      ...(tr.received_at ? [{ event: tr.has_discrepancy ? 'received_with_discrepancy' : 'received', at: tr.received_at, by: names[tr.received_by] || null }] : []),
      ...(tr.cancelled_at ? [{ event: 'cancelled', at: tr.cancelled_at, by: names[tr.cancelled_by] || null }] : []),
    ]
    const sentTotal = items.reduce((n, it) => n + (Number(it.quantity_sent) || 0), 0)
    const receivedTotal = tr.status === 'received' ? items.reduce((n, it) => n + (Number(it.quantity_received) || 0), 0) : null

    return NextResponse.json({
      workflow,
      data: {
        ...tr,
        stock_transfer_items: lines,
        source_shop_name: shopMap[tr.source_shop_id]?.name ?? null,
        destination_shop_name: shopMap[tr.destination_shop_id]?.name ?? null,
        same_currency: shopMap[tr.source_shop_id]?.currency === shopMap[tr.destination_shop_id]?.currency,
        source_currency: shopMap[tr.source_shop_id]?.currency ?? null,
        created_by_name: names[tr.created_by] || null,
        sent_by_name: names[tr.sent_by ?? tr.created_by] || null,
        received_by_name: names[tr.received_by] || null,
        cancelled_by_name: names[tr.cancelled_by] || null,
        units_sent: sentTotal,
        units_received: receivedTotal,
        units_missing: receivedTotal == null ? 0 : Math.max(0, sentTotal - receivedTotal),
        history,
        can_view_cost: showCost,
        can_receive: tr.status === 'sent' && dst.write,
        can_send: tr.status === 'draft' && src.write && workflow,
        can_edit: tr.status === 'draft' && src.write && workflow,
        can_cancel: (tr.status === 'draft' || tr.status === 'sent') && src.write,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// PATCH /api/stock-transfers/[id] — modifier un BROUILLON (destination, notes, produits). La source est relue en base ;
// droit « Transferts » en modification dans CETTE source. expected_updated_at : refus si modifié entre-temps.
// body: { destination_shop_id, notes?, items: [{product_id, quantity}], expected_updated_at? }
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    if (!isUuid(params.id)) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    const { destination_shop_id, notes, items, expected_updated_at } = await request.json()
    if (!isUuid(destination_shop_id) || !Array.isArray(items) || !items.length) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })

    const admin = await createAdminClient() as any
    if (!(await transferWorkflowAvailable(admin))) return NextResponse.json({ error: t('transfer_draft_unavailable') }, { status: 503 })
    const { data: tr } = await admin.from('stock_transfers').select('source_shop_id').eq('id', params.id).maybeSingle()
    if (!tr) return NextResponse.json({ error: t('transfer_not_found') }, { status: 404 })
    const role = await checkShopRole(supabase, user.id, tr.source_shop_id)
    if (!role || !(await canWriteFeature(supabase, role, tr.source_shop_id, 'transfers')))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const { data, error } = await admin.rpc('update_stock_transfer_draft', {
      p_transfer_id: params.id, p_source: tr.source_shop_id, p_dest: destination_shop_id, p_user: user.id, p_notes: notes || null,
      p_items: items.map((it: any) => ({ product_id: String(it?.product_id || ''), quantity: Math.floor(Number(it?.quantity) || 0) })),
      p_expected_updated_at: expected_updated_at || null,
    })
    if (error) {
      const e = transferError(error)
      return NextResponse.json({ error: e ? t(e.key as any, e.params as any) : error.message, code: e?.key }, { status: 400 })
    }
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
