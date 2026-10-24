import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { getApiTranslator } from '@/lib/api/i18n'
import {
  batchTreatmentsAvailable, batchTreatmentErrorResponse, lotForUser, treatmentReason, validRequestId,
  PHOTO_BUCKET, PHOTO_URL_SECONDS,
} from '@/lib/api/batch-treatments'

// Traitement d'un lot (migration 179).
// GET  ?batch_id=… — historique du lot (événements + photos, liens signés 10 min, jamais enregistrés), ventes
//                    hors ligne qu'il peut résoudre (droit Stock en modification) ; droit Stock en lecture.
//                    Aucun prix d'achat n'est renvoyé.
// POST { batch_id, action, quantity?, new_quantity?, new_expiry_date?, reason_code?, note?, request_id,
//        corrects_treatment_id? } — dispose / supplier_return / quantity_adjustment / date_correction, droit
//        Stock en modification dans la boutique RÉELLE du lot ; la base calcule l'écart et applique les règles.
// Avant la 179 : GET → { available: false } ; POST → 409.

const ACTIONS = ['dispose', 'supplier_return', 'quantity_adjustment', 'date_correction'] as const
const isDay = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + 'T00:00:00Z'))
const intOrNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number.isInteger(Number(v)) ? Number(v) : NaN)

export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const admin = await createAdminClient() as any
    const access = await lotForUser(supabase, admin, user.id, new URL(request.url).searchParams.get('batch_id'), 'view', t)
    if (!access.ok) return access.response
    const { lot } = access
    const canWrite = await canWriteFeature(supabase, access.role, lot.shop_id, 'stock')
    if (!(await batchTreatmentsAvailable(admin))) {
      return NextResponse.json({ available: false, can_write: canWrite, has_supplier: !!lot.supplier_id, treatments: [], candidates: [] })
    }

    const { data: rows, error } = await admin.from('batch_treatments')
      .select('id, action, quantity, lot_qty_before, lot_qty_after, old_expiry_date, new_expiry_date, supplier_name, sale_id, sale_number, reason_code, note, corrects_treatment_id, performed_by, performed_by_name, created_at')
      .eq('batch_id', lot.id).eq('shop_id', lot.shop_id).order('created_at', { ascending: false }).limit(200)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    const ids = (rows || []).map((r: any) => r.id)
    const { data: photos } = ids.length
      ? await admin.from('batch_treatment_photos').select('id, treatment_id, storage_path, created_at').in('treatment_id', ids).order('created_at')
      : { data: [] }
    const signed: Record<string, string> = {}
    const paths = (photos || []).map((p: any) => p.storage_path)
    if (paths.length) {
      const { data: urls } = await admin.storage.from(PHOTO_BUCKET).createSignedUrls(paths, PHOTO_URL_SECONDS)
      for (const u of urls || []) if (u?.path && u?.signedUrl) signed[u.path] = u.signedUrl
    }
    const now = Date.now()
    const treatments = (rows || []).map((r: any) => ({
      ...r,
      photos: (photos || []).filter((p: any) => p.treatment_id === r.id).map((p: any) => ({ id: p.id, url: signed[p.storage_path] ?? null })),
      // Ajout de photo : auteur seulement, 30 minutes au plus (la base revérifie)
      can_add_photo: canWrite && r.performed_by === user.id && now - Date.parse(r.created_at) < 30 * 60_000,
    }))

    let candidates: any[] = []
    if (canWrite) {
      const { data } = await admin.rpc('unallocated_candidates', { p_batch_id: lot.id })
      candidates = data || []
    }
    return NextResponse.json({ available: true, can_write: canWrite, has_supplier: !!lot.supplier_id, treatments, candidates })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

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

    const action = body.action
    if (!(ACTIONS as readonly string[]).includes(action)) return NextResponse.json({ error: t('batch_invalid_request') }, { status: 400 })
    if (!validRequestId(body.request_id)) return NextResponse.json({ error: t('batch_invalid_request') }, { status: 400 })
    const quantity = intOrNull(body.quantity), newQuantity = intOrNull(body.new_quantity)
    if (Number.isNaN(quantity) || Number.isNaN(newQuantity)) return NextResponse.json({ error: t('batch_invalid_quantity') }, { status: 400 })
    if (action === 'date_correction' && body.new_expiry_date != null && !isDay(body.new_expiry_date))
      return NextResponse.json({ error: t('date_invalid') }, { status: 400 })
    const note = typeof body.note === 'string' ? body.note.slice(0, 1000) : null

    const { data, error } = await admin.rpc('treat_batch', {
      p_shop_id: access.lot.shop_id,
      p_batch_id: access.lot.id,
      p_action: action,
      p_quantity: action === 'dispose' || action === 'supplier_return' ? quantity : null,
      p_new_quantity: action === 'quantity_adjustment' ? newQuantity : null,
      p_new_expiry_date: action === 'date_correction' ? (body.new_expiry_date ?? null) : null,
      p_reason_code: action === 'quantity_adjustment' ? treatmentReason(body.reason_code) : null,
      p_note: note,
      p_request_id: body.request_id,
      p_performed_by: user.id,
      p_corrects_treatment_id: typeof body.corrects_treatment_id === 'string' ? body.corrects_treatment_id : null,
    })
    if (error) return batchTreatmentErrorResponse(error, t) ?? NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
