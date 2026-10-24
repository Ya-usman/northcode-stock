// Traitement des lots (migration 179) côté SERVEUR — compatible avant / après la 179.
// Tant que la table batch_treatments n'existe pas, les anciennes routes gardent leur chemin d'origine et les
// nouvelles répondent « indisponible » ; dès qu'elle existe, toute correction de quantité ou de date d'un lot
// passe par treat_batch (historique immuable) — un seul chemin métier.
// La boutique, le produit et le fournisseur sont TOUJOURS relus depuis le lot, jamais pris du navigateur.
import { NextResponse } from 'next/server'
import { checkShopRole } from '@/lib/api/shop-auth'
import { canViewFeature, canWriteFeature } from '@/lib/api/role-permissions'

let tableCache: { at: number; value: boolean } | null = null

/** La migration 179 est-elle appliquée ? (table batch_treatments ; cache 60 s, bascule seule après application) */
export async function batchTreatmentsAvailable(admin: any): Promise<boolean> {
  if (tableCache && Date.now() - tableCache.at < 60_000) return tableCache.value
  // Requête ordinaire (jamais HEAD : sa réponse d'erreur n'a pas de corps, donc pas de code) ; TOUTE erreur =
  // indisponible — en cas de doute, l'ancien chemin d'origine reste utilisé
  const { error } = await admin.from('batch_treatments').select('id').limit(1)
  const value = !error
  tableCache = { at: Date.now(), value }
  return value
}

export const PHOTO_BUCKET = 'batch-treatment-photos'
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024
export const PHOTO_MAX_PER_TREATMENT = 3
export const PHOTO_URL_SECONDS = 600

/** Motifs d'ajustement de la 179 */
export const ADJUST_REASONS = ['damage', 'loss', 'theft', 'counting_error', 'other'] as const
export type AdjustReason = typeof ADJUST_REASONS[number]

/** Motif envoyé à l'ANCIENNE fonction adjust_batch_quantity (avant la 179) */
export function legacyReason(code: unknown): string {
  if (code === 'counting_error') return 'correction'
  return typeof code === 'string' && ['damage', 'loss', 'theft', 'expiry', 'other', 'correction'].includes(code) ? code : 'correction'
}

/** Motif de la 179 à partir d'un motif reçu (anciens écrans compris) */
export function treatmentReason(code: unknown): AdjustReason {
  if (code === 'correction') return 'counting_error'
  return (ADJUST_REASONS as readonly string[]).includes(code as string) ? code as AdjustReason : 'other'
}

type T = (key: any, values?: any) => string

/** Lot + droits de l'utilisateur dans la boutique RÉELLE du lot */
export async function lotForUser(supabase: any, admin: any, userId: string, batchId: unknown, need: 'view' | 'write', t: T):
  Promise<{ ok: true; lot: any; role: string } | { ok: false; response: NextResponse }> {
  if (typeof batchId !== 'string' || !/^[0-9a-f-]{36}$/i.test(batchId))
    return { ok: false, response: NextResponse.json({ error: t('batch_not_found') }, { status: 404 }) }
  const { data: lot } = await admin.from('product_batches')
    .select('id, shop_id, product_id, quantity, expiry_date, supplier_id, created_at').eq('id', batchId).maybeSingle()
  if (!lot) return { ok: false, response: NextResponse.json({ error: t('batch_not_found') }, { status: 404 }) }
  const role = await checkShopRole(supabase, userId, lot.shop_id)
  const allowed = role && (need === 'write' ? await canWriteFeature(supabase, role, lot.shop_id, 'stock') : await canViewFeature(supabase, role, lot.shop_id, 'stock'))
  if (!allowed) return { ok: false, response: NextResponse.json({ error: t('permission_denied') }, { status: 403 }) }
  return { ok: true, lot, role: role as string }
}

const field = (detail: unknown): Record<string, any> => {
  try { return typeof detail === 'string' ? JSON.parse(detail) : {} } catch { return {} }
}

/** Erreurs P0040–P0049 (179) → réponse lisible ; null si l'erreur n'en fait pas partie */
export function batchTreatmentErrorResponse(error: any, t: T): NextResponse | null {
  const code = error?.code as string | undefined
  const d = field(error?.details)
  const body = (key: string, status: number, values?: Record<string, any>) =>
    NextResponse.json({ error: t(key as any, values), code: key, detail: d }, { status })
  switch (code) {
    case 'P0040': return body('batch_unallocated_pending', 409, { count: d.pending ?? 0 })
    case 'P0041': return body('batch_request_conflict', 409)
    case 'P0042': return body('batch_no_supplier', 400)
    case 'P0043': return body(d.requested != null || d.new_quantity != null || d.delta != null ? 'batch_invalid_quantity' : 'batch_invalid_request', 400)
    case 'P0044': return body('batch_not_expired', 400)
    case 'P0045': return body('batch_expiry_requires_treatment', 409)
    case 'P0046': return body(d.field === 'reason_code' ? 'batch_reason_required' : 'batch_note_required', 400)
    case 'P0047': return body('batch_not_resolvable', 404)
    case 'P0048': return body('batch_unallocated_insufficient', 409, { count: d.pending ?? 0 })
    case 'P0049': return body(d.reason === 'window' ? 'batch_photo_window_closed' : 'batch_photo_limit', 400)
  }
  return null
}

/** Identifiant de requête valable (idempotence) : 8 à 120 caractères sûrs */
export function validRequestId(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_.:-]{8,120}$/.test(id)
}
