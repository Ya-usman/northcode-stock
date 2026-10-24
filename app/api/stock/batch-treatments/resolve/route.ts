import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/api/shop-auth'
import { getApiTranslator } from '@/lib/api/i18n'
import { batchTreatmentsAvailable, batchTreatmentErrorResponse, lotForUser, validRequestId } from '@/lib/api/batch-treatments'

// POST /api/stock/batch-treatments/resolve — { batch_id, sale_id, quantity, note, request_id }
// Attribue à CE lot des unités déjà vendues hors ligne et non attribuées (179, resolve_unallocated) :
// traçabilité du lot uniquement — le stock produit N'EST PAS modifié, aucun mouvement de stock. Droit Stock en
// modification dans la boutique réelle du lot ; vente, produit et éligibilité vérifiés par la base.
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const admin = await createAdminClient() as any
    const access = await lotForUser(supabase, admin, user.id, body.batch_id, 'write', t)
    if (!access.ok) return access.response
    if (!(await batchTreatmentsAvailable(admin))) return NextResponse.json({ error: t('batch_treatments_unavailable') }, { status: 409 })
    if (typeof body.sale_id !== 'string' || !validRequestId(body.request_id) || !Number.isInteger(Number(body.quantity)))
      return NextResponse.json({ error: t('batch_invalid_request') }, { status: 400 })

    const { data, error } = await admin.rpc('resolve_unallocated', {
      p_shop_id: access.lot.shop_id,
      p_sale_id: body.sale_id,
      p_product_id: access.lot.product_id,
      p_batch_id: access.lot.id,
      p_quantity: Number(body.quantity),
      p_note: typeof body.note === 'string' ? body.note.slice(0, 1000) : null,
      p_request_id: body.request_id,
      p_performed_by: user.id,
    })
    if (error) return batchTreatmentErrorResponse(error, t) ?? NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
