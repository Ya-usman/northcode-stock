import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { getApiTranslator } from '@/lib/api/i18n'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { batchTreatmentsAvailable, batchTreatmentErrorResponse, validRequestId } from '@/lib/api/batch-treatments'

// Lots = niveau « modification » de Produits / Stock (règle unique, lot 1).
// PATCH /api/product-batches/expiry — correct or clear a batch's expiry
// date (e.g. it was set by mistake on a product that doesn't expire).
// body: { id, shop_id, expiry_date, note?, request_id? } — expiry_date: 'YYYY-MM-DD' or null to clear.
// La date change le statut du lot (sain, expire bientôt, périmé) et donc le « Disponible » : chaque
// modification est inscrite au journal d'activité (ancienne et nouvelle date), comme la promo d'un lot.
// Migration 179 présente : la correction devient un événement date_correction (treat_batch, historique
// immuable, note obligatoire) — la base refuse toute autre écriture de la date (garde P0045). Avant la 179 :
// écriture directe d'origine.
export async function PATCH(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { id, shop_id, expiry_date, note, request_id } = await request.json()
    if (!id || !shop_id) return NextResponse.json({ error: t('id_shop_id_required') }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !(await canWriteFeature(supabase, role, shop_id, 'stock')))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    if (expiry_date != null && (typeof expiry_date !== 'string' || isNaN(new Date(expiry_date).getTime())))
      return NextResponse.json({ error: t('date_invalid') }, { status: 400 })
    const newDate: string | null = expiry_date ? String(expiry_date).slice(0, 10) : null

    const admin = await createAdminClient() as any

    const { data: before } = await admin
      .from('product_batches')
      .select('expiry_date, product_id')
      .eq('id', id)
      .eq('shop_id', shop_id)
      .maybeSingle()
    if (!before) return NextResponse.json({ error: t('batch_not_found') }, { status: 404 })

    let data: any
    if (await batchTreatmentsAvailable(admin)) {
      const { data: result, error } = await admin.rpc('treat_batch', {
        p_shop_id: shop_id, p_batch_id: id, p_action: 'date_correction',
        p_quantity: null, p_new_quantity: null, p_new_expiry_date: newDate, p_reason_code: null,
        p_note: typeof note === 'string' ? note.slice(0, 1000) : null,
        p_request_id: validRequestId(request_id) ? request_id : `expiry-${randomUUID()}`,
        p_performed_by: user.id, p_corrects_treatment_id: null,
      })
      if (error) return batchTreatmentErrorResponse(error, t) ?? NextResponse.json({ error: error.message }, { status: 400 })
      data = { id, expiry_date: newDate, treatment: result }
    } else {
      const { data: row, error } = await admin
        .from('product_batches')
        .update({ expiry_date: newDate })
        .eq('id', id)
        .eq('shop_id', shop_id)
        .select()
        .single()
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      if (!row) return NextResponse.json({ error: t('batch_not_found') }, { status: 404 })
      data = row
    }

    if ((before.expiry_date ?? null) !== (data.expiry_date ?? null)) {
      const { data: product } = await admin.from('products').select('name').eq('id', before.product_id).single()
      const { data: actorProfile } = await admin.from('profiles').select('full_name').eq('id', user.id).single()
      await writeAuditLog({
        action: 'update_batch_expiry',
        shop_id, actor_id: user.id, actor_email: user.email,
        target_id: id, target_type: 'product_batch',
        ip: getClientIp(request),
        metadata: {
          actor_name: actorProfile?.full_name || user.email,
          product_name: product?.name || null,
          product_id: before.product_id,
          old_date: before.expiry_date ?? null,
          new_date: data.expiry_date ?? null,
        },
      })
    }

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
