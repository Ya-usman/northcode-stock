import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/api/shop-auth'
import { getApiTranslator } from '@/lib/api/i18n'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { sniffImage } from '@/lib/api/image-type'
import {
  batchTreatmentsAvailable, batchTreatmentErrorResponse, lotForUser, PHOTO_BUCKET, PHOTO_MAX_BYTES,
} from '@/lib/api/batch-treatments'

// POST /api/stock/batch-treatments/photo — multipart { treatment_id, file }
// Photo justificative ajoutée APRÈS le traitement (179) : auteur du traitement, 30 minutes au plus, 3 au plus,
// JPEG / PNG / WebP réels (signature lue), 2 Mo au plus. Ordre : envoi du fichier → enregistrement en base
// (register_batch_treatment_photo, qui revérifie tout sous verrou) → si l'enregistrement est refusé, le fichier
// est supprimé ; si cette suppression échoue, le fichier orphelin est signalé (journal serveur + audit
// batch_photo_orphan avec son chemin exact) et la réponse le dit — jamais « aucun résidu ».
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const admin = await createAdminClient() as any
    if (!(await batchTreatmentsAvailable(admin))) return NextResponse.json({ error: t('batch_treatments_unavailable') }, { status: 409 })

    const form = await request.formData()
    const treatmentId = form.get('treatment_id')
    const file = form.get('file')
    if (typeof treatmentId !== 'string' || !(file instanceof Blob)) return NextResponse.json({ error: t('batch_invalid_request') }, { status: 400 })

    const { data: treatment } = await admin.from('batch_treatments').select('id, shop_id, batch_id, performed_by').eq('id', treatmentId).maybeSingle()
    if (!treatment) return NextResponse.json({ error: t('batch_not_resolvable') }, { status: 404 })
    const access = await lotForUser(supabase, admin, user.id, treatment.batch_id, 'write', t)
    if (!access.ok) return access.response
    if (access.lot.shop_id !== treatment.shop_id || treatment.performed_by !== user.id)
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    if (file.size <= 0 || file.size > PHOTO_MAX_BYTES) return NextResponse.json({ error: t('batch_photo_too_large') }, { status: 400 })
    const bytes = new Uint8Array(await file.arrayBuffer())
    const kind = sniffImage(bytes)
    if (!kind || kind.mime === 'image/gif') return NextResponse.json({ error: t('batch_photo_type') }, { status: 400 })

    const path = `${treatment.shop_id}/${treatment.batch_id}/${treatment.id}/${randomUUID()}.${kind.ext}`
    const { error: upErr } = await admin.storage.from(PHOTO_BUCKET).upload(path, Buffer.from(bytes), { contentType: kind.mime, upsert: false })
    if (upErr) return NextResponse.json({ error: t('batch_photo_upload_failed') }, { status: 502 })

    const { data: photoId, error } = await admin.rpc('register_batch_treatment_photo', {
      p_shop_id: treatment.shop_id, p_treatment_id: treatment.id, p_storage_path: path,
      p_mime_type: kind.mime, p_size_bytes: bytes.length, p_uploaded_by: user.id,
    })
    if (error) {
      // Enregistrement refusé : le fichier envoyé ne doit pas rester
      const { error: rmErr } = await admin.storage.from(PHOTO_BUCKET).remove([path])
      if (rmErr) {
        console.error('[batch-photo] fichier orphelin, suppression impossible :', path, rmErr.message)
        await writeAuditLog({
          action: 'batch_photo_orphan', shop_id: treatment.shop_id, actor_id: user.id, actor_email: user.email,
          target_id: treatment.id, target_type: 'batch_treatment', ip: getClientIp(request),
          metadata: { bucket: PHOTO_BUCKET, path, reason: error.message, cleanup_error: rmErr.message },
        })
        const res = batchTreatmentErrorResponse(error, t)
        const payload = res ? await res.json() : { error: error.message }
        return NextResponse.json({ ...payload, orphan: { bucket: PHOTO_BUCKET, path } }, { status: res?.status ?? 400 })
      }
      return batchTreatmentErrorResponse(error, t) ?? NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ data: { id: photoId } })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
