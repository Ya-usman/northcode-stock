import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { omitCost } from '@/lib/api/cost-fields'
import { getApiTranslator } from '@/lib/api/i18n'
import { batchTreatmentsAvailable, batchTreatmentErrorResponse, legacyReason, treatmentReason, validRequestId } from '@/lib/api/batch-treatments'

// Lots = niveau « modification » de Produits / Stock (règle unique, lot 1).
// PATCH /api/product-batches/adjust — correct the remaining quantity of a
// specific batch (e.g. miscount at reception). Keeps products.quantity in
// sync and writes the correction to stock_movements.
// body: { id, shop_id, new_quantity, reason_code, note?, request_id? }
// Migration 179 présente : événement quantity_adjustment (treat_batch — historique immuable, écart calculé
// par la base, jamais de stock négatif, blocage P0040 d'un lot périmé candidat à une vente non attribuée) ;
// l'ancienne fonction adjust_batch_quantity n'est alors plus exécutable. Avant la 179 : chemin d'origine.
export async function PATCH(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { id, shop_id, new_quantity, reason_code, note, request_id } = await request.json()
    if (!id || !shop_id) return NextResponse.json({ error: t('id_shop_id_required') }, { status: 400 })
    if (!Number.isInteger(Number(new_quantity)) || Number(new_quantity) < 0) return NextResponse.json({ error: t('invalid_quantity') }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !(await canWriteFeature(supabase, role, shop_id, 'stock')))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any

    if (await batchTreatmentsAvailable(admin)) {
      const { data, error } = await admin.rpc('treat_batch', {
        p_shop_id: shop_id, p_batch_id: id, p_action: 'quantity_adjustment',
        p_quantity: null, p_new_quantity: Number(new_quantity), p_new_expiry_date: null,
        p_reason_code: treatmentReason(reason_code),
        p_note: typeof note === 'string' ? note.slice(0, 1000) : null,
        p_request_id: validRequestId(request_id) ? request_id : `adjust-${randomUUID()}`,
        p_performed_by: user.id, p_corrects_treatment_id: null,
      })
      if (error) return batchTreatmentErrorResponse(error, t) ?? NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ data: omitCost({ batch_quantity: data?.lot_quantity, product_quantity: data?.product_quantity, treatment: data }) })
    }

    const { data, error } = await admin.rpc('adjust_batch_quantity', {
      p_batch_id: id,
      p_shop_id: shop_id,
      p_new_quantity: Number(new_quantity),
      p_reason_code: legacyReason(reason_code),
      p_performed_by: user.id,
    })

    if (error) {
      if (error.message?.includes('batch_not_found')) return NextResponse.json({ error: t('batch_not_found') }, { status: 404 })
      if (error.message?.includes('invalid_quantity')) return NextResponse.json({ error: t('invalid_quantity') }, { status: 400 })
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ data: omitCost(data) }) // opération de stock : jamais de coût dans la réponse
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
