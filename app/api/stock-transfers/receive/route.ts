import { NextResponse } from 'next/server'
import { completeTransferCreatedProducts } from '@/lib/api/transfer-created-products'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'
import { DISCREPANCY_CATEGORIES, isUuid, loadNames, ownSendBlocked, transferError, transferWorkflowAvailable } from '@/lib/api/transfers'
import { cleanSerials, serialErrorResponse } from '@/lib/api/serials'

// POST /api/stock-transfers/receive — réception DÉFINITIVE (migration 188, une seule opération) : toutes les lignes,
// quantité reçue entre 0 et l'envoyé ; le manque est un écart enregistré (cause et précision facultatives) ; stock et
// lots d'arrivée mis à jour ; journal écrit par la base. receipt_key : un renvoi par le même appareil n'est pas
// rejoué ; une seconde réception reçoit « déjà réceptionné » (date, personne). La boutique de DESTINATION est relue en
// base ; droit « Transferts » en modification sur elle. Avant la 188 : ancienne réception (receive_stock_transfer).
// Boutique qui réceptionne (1er nov. 2026) : acting_shop_id = la boutique choisie en haut de l'écran, qui DOIT être la
// destination (jamais depuis la boutique de départ ni « Toutes ») ; qui a envoyé le transfert ne le réceptionne pas
// lui-même, sauf propriétaire / gérant (ownSendBlocked).
// body: { transfer_id, acting_shop_id, receipt_key?, items: [{transfer_item_id, quantity_received, destination_product_id?,
//   discrepancy_category?, discrepancy_detail?}] }
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const { transfer_id, items, receipt_key, acting_shop_id } = await request.json()
    if (!isUuid(transfer_id)) return NextResponse.json({ error: t('transfer_destination_id_required') }, { status: 400 })
    if (!Array.isArray(items) || items.length === 0) return NextResponse.json({ error: t('at_least_one_line_required') }, { status: 400 })

    const admin = await createAdminClient() as any
    const { data: tr } = await admin.from('stock_transfers').select('destination_shop_id, reference, sent_by, created_by').eq('id', transfer_id).maybeSingle()
    if (!tr) return NextResponse.json({ error: t('transfer_not_found') }, { status: 404 })
    const role = await checkShopRole(supabase, user.id, tr.destination_shop_id)
    if (!role || !(await canWriteFeature(supabase, role, tr.destination_shop_id, 'transfers')))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    if (acting_shop_id !== tr.destination_shop_id) {
      const { data: dest } = await admin.from('shops').select('name').eq('id', tr.destination_shop_id).maybeSingle()
      return NextResponse.json({ error: t('transfer_receive_wrong_shop', { shop: dest?.name || '' }), code: 'transfer_receive_wrong_shop', destination_shop_name: dest?.name ?? null }, { status: 409 })
    }
    if (ownSendBlocked(tr, user.id, role))
      return NextResponse.json({ error: t('transfer_receive_own_send'), code: 'transfer_receive_own_send' }, { status: 403 })

    const workflow = await transferWorkflowAvailable(admin)
    // Numéros arrivés (lot C, migration 199) : un par unité reçue, parmi ceux en transit de la ligne
    const lines = items.map((it: any) => ({
      serials_received: cleanSerials(it?.serials_received) ?? [],
      item_id: it?.transfer_item_id,
      quantity_received: Math.floor(Number(it?.quantity_received)),
      destination_product_id: isUuid(it?.destination_product_id) ? it.destination_product_id : null,
      discrepancy_category: (DISCREPANCY_CATEGORIES as readonly string[]).includes(it?.discrepancy_category) ? it.discrepancy_category : null,
      discrepancy_detail: typeof it?.discrepancy_detail === 'string' ? it.discrepancy_detail.trim().slice(0, 300) || null : null,
    }))
    if (lines.some((l: any) => !isUuid(l.item_id) || !Number.isFinite(l.quantity_received) || l.quantity_received < 0))
      return NextResponse.json({ error: t('transfer_invalid_quantity', { product: '', max: 0 }) }, { status: 400 })

    const { count: inTransitSerials } = await admin.from('product_serials').select('id', { count: 'exact', head: true }).eq('transfer_id', transfer_id).eq('status', 'in_transit')
    const { data, error } = workflow && (inTransitSerials || 0) > 0
      ? await admin.rpc('receive_transfer_with_serials', {
          p_transfer_id: transfer_id, p_dest: tr.destination_shop_id, p_user: user.id,
          p_receipt_key: isUuid(receipt_key) ? receipt_key : crypto.randomUUID(), p_lines: lines,
        })
      : workflow
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
      const se = serialErrorResponse(error, t)
      if (se) return NextResponse.json(se.body, { status: se.status })
      const e = transferError(error)
      if (e?.key === 'transfer_already_received') {
        // « Déjà réceptionné » : date et personne de la première réception
        const names = await loadNames(admin, [e.detail?.received_by])
        return NextResponse.json({ error: t('transfer_already_received'), code: e.key, received_at: e.detail?.received_at ?? null, received_by_name: names[e.detail?.received_by] || null }, { status: 409 })
      }
      return NextResponse.json({ error: e ? t(e.key as any, e.params as any) : error.message, code: e?.key }, { status: 400 })
    }

    // Produits créés à l'arrivée : fiche complétée depuis le produit d'origine + « Produit créé » au journal (lot D)
    const createdIds = (Array.isArray(data?.created_products) ? data.created_products : []).map((c: any) => c?.product_id).filter(isUuid)
    if (createdIds.length && !data?.replayed) {
      const { data: me } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
      await completeTransferCreatedProducts(admin, { transferId: transfer_id, reference: tr.reference, destShopId: tr.destination_shop_id, createdIds,
        actor: { id: user.id, email: user.email, name: me?.full_name ?? null }, ip: getClientIp(request) })
        .catch((e: any) => console.error('[transfers] fiche des produits créés non complétée', e?.message))
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
