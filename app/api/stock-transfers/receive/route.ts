import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'
import { DISCREPANCY_CATEGORIES, isUuid, loadNames, transferError, transferWorkflowAvailable } from '@/lib/api/transfers'

// POST /api/stock-transfers/receive — réception DÉFINITIVE (migration 188, une seule opération) : toutes les lignes,
// quantité reçue entre 0 et l'envoyé ; le manque est un écart enregistré (cause et précision facultatives) ; stock et
// lots d'arrivée mis à jour ; journal écrit par la base. receipt_key : un renvoi par le même appareil n'est pas
// rejoué ; une seconde réception reçoit « déjà réceptionné » (date, personne). La boutique de DESTINATION est relue en
// base ; droit « Transferts » en modification sur elle. Avant la 188 : ancienne réception (receive_stock_transfer).
// body: { transfer_id, receipt_key?, items: [{transfer_item_id, quantity_received, destination_product_id?,
//   discrepancy_category?, discrepancy_detail?}] }
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const { transfer_id, items, receipt_key } = await request.json()
    if (!isUuid(transfer_id)) return NextResponse.json({ error: t('transfer_destination_id_required') }, { status: 400 })
    if (!Array.isArray(items) || items.length === 0) return NextResponse.json({ error: t('at_least_one_line_required') }, { status: 400 })

    const admin = await createAdminClient() as any
    const { data: tr } = await admin.from('stock_transfers').select('destination_shop_id, reference').eq('id', transfer_id).maybeSingle()
    if (!tr) return NextResponse.json({ error: t('transfer_not_found') }, { status: 404 })
    const role = await checkShopRole(supabase, user.id, tr.destination_shop_id)
    if (!role || !(await canWriteFeature(supabase, role, tr.destination_shop_id, 'transfers')))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const workflow = await transferWorkflowAvailable(admin)
    const lines = items.map((it: any) => ({
      item_id: it?.transfer_item_id,
      quantity_received: Math.floor(Number(it?.quantity_received)),
      destination_product_id: isUuid(it?.destination_product_id) ? it.destination_product_id : null,
      discrepancy_category: (DISCREPANCY_CATEGORIES as readonly string[]).includes(it?.discrepancy_category) ? it.discrepancy_category : null,
      discrepancy_detail: typeof it?.discrepancy_detail === 'string' ? it.discrepancy_detail.trim().slice(0, 300) || null : null,
    }))
    if (lines.some((l: any) => !isUuid(l.item_id) || !Number.isFinite(l.quantity_received) || l.quantity_received < 0))
      return NextResponse.json({ error: t('transfer_invalid_quantity', { product: '', max: 0 }) }, { status: 400 })

    const { data, error } = workflow
      ? await admin.rpc('receive_stock_transfer_final', {
          p_transfer_id: transfer_id, p_dest: tr.destination_shop_id, p_user: user.id,
          p_receipt_key: isUuid(receipt_key) ? receipt_key : crypto.randomUUID(), p_lines: lines,
        })
      : await admin.rpc('receive_stock_transfer', {
          p_transfer_id: transfer_id, p_destination_shop_id: tr.destination_shop_id, p_performed_by: user.id,
          p_items: lines.map((l: any) => ({ transfer_item_id: l.item_id, quantity_received: l.quantity_received, destination_product_id: l.destination_product_id,
            discrepancy_category: l.discrepancy_category, discrepancy_detail: l.discrepancy_detail })),
        })
    if (error) {
      const e = transferError(error)
      if (e?.key === 'transfer_already_received') {
        // « Déjà réceptionné » : date et personne de la première réception
        const names = await loadNames(admin, [e.detail?.received_by])
        return NextResponse.json({ error: t('transfer_already_received'), code: e.key, received_at: e.detail?.received_at ?? null, received_by_name: names[e.detail?.received_by] || null }, { status: 409 })
      }
      return NextResponse.json({ error: e ? t(e.key as any, e.params as any) : error.message, code: e?.key }, { status: 400 })
    }

    if (!workflow) {
      const { data: actorProfile } = await admin.from('profiles').select('full_name').eq('id', user.id).single()
      await writeAuditLog({
        action: 'stock_transfer.receive', shop_id: tr.destination_shop_id, actor_id: user.id, actor_email: user.email,
        target_id: transfer_id, target_type: 'stock_transfer', ip: getClientIp(request),
        metadata: { actor_name: actorProfile?.full_name || user.email, reference: tr.reference },
      })
    }
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
