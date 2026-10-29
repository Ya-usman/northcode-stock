// ── Transferts entre boutiques V1, côté SERVEUR (migration 188, conception validée le 30 oct. 2026) ─────────────────
// brouillon → en transit (« sent ») → reçu ; annulé. Réception UNIQUE et définitive : le manque est un écart
// enregistré (pas de réception partielle). Envoi lot par lot (FEFO, stock vendable). QR : identifiant + jeton aléatoire
// (table réservée au serveur) ; un scan n'ouvre que l'écran de réception, les droits sont toujours vérifiés ici.
// Tant que la 188 n'est pas appliquée, les routes gardent l'ancien parcours (workflow indisponible).

/** Erreurs codées de la base (188) → clés de traduction api_errors */
const ERROR_KEYS: Record<string, string> = {
  P0060: 'transfer_same_shop', P0061: 'transfer_other_company', P0062: 'transfer_empty', P0063: 'transfer_not_found',
  P0064: 'transfer_not_draft', P0065: 'transfer_changed', P0066: 'transfer_product_not_found',
  P0067: 'transfer_insufficient_stock', P0068: 'transfer_not_in_transit', P0070: 'transfer_destination_product_not_found',
  P0074: 'transfer_not_cancellable', P0076: 'transfer_invalid_quantity', P0078: 'transfer_already_received',
  P0080: 'transfer_lines_incomplete',
}

const detailOf = (err: any): Record<string, any> => {
  try { return JSON.parse(String(err?.details || '{}')) } catch { return {} }
}

/** Clé de traduction + paramètres d'une erreur de transfert (null : erreur non codée) */
export function transferError(err: any): { key: string; params?: Record<string, string | number>; detail?: Record<string, any> } | null {
  const key = ERROR_KEYS[String(err?.code || '')]
  if (!key) return null
  const d = detailOf(err)
  if (key === 'transfer_insufficient_stock') return { key, params: { product: String(d.product ?? ''), transferable: Number(d.transferable ?? 0), requested: Number(d.requested ?? 0) } }
  if (key === 'transfer_invalid_quantity') return { key, params: { product: String(d.product ?? ''), max: Number(d.max ?? 0) } }
  if (key === 'transfer_already_received') return { key, detail: { received_at: d.received_at ?? null, received_by: d.received_by ?? null } }
  return { key }
}

/** La 188 est-elle appliquée ? (table des allocations présente). Lecture réelle, pas une requête « head » : une
 *  requête « head » sur une table absente ne renvoie pas d'erreur (défaut corrigé le 30 oct. 2026). */
export async function transferWorkflowAvailable(admin: any): Promise<boolean> {
  const { error } = await admin.from('stock_transfer_allocations').select('id').limit(1)
  if (!error) return true
  const msg = String(error.message || '')
  if (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache|Could not find/i.test(msg)) return false
  throw new Error(msg)
}

export const DISCREPANCY_CATEGORIES = ['transport_loss', 'theft', 'breakage', 'count_error', 'other'] as const

export interface AllocationView {
  coverage: 'batch' | 'uncovered' | 'legacy'
  source_expiry_date: string | null
  source_received_at: string | null
  quantity_sent: number
  quantity_received: number
  quantity_missing: number
  quantity_returned: number
  quantity_in_transit: number
  destination_batch_id: string | null
  unit_cost?: number | null
}

/** Allocations par ligne (188). Coût seulement si withCost. Lecture serveur (rôle de service). */
export async function loadAllocations(admin: any, transferIds: string[], withCost: (transferId: string) => boolean): Promise<Record<string, AllocationView[]>> {
  const out: Record<string, AllocationView[]> = {}
  if (!transferIds.length) return out
  const { data, error } = await admin.from('stock_transfer_allocations')
    .select('transfer_id, item_id, coverage, source_expiry_date, source_received_at, quantity_sent, quantity_received, quantity_missing, quantity_returned, quantity_in_transit, destination_batch_id, unit_cost')
    .in('transfer_id', transferIds)
    .order('source_expiry_date', { ascending: true, nullsFirst: false })
  if (error) throw new Error(error.message)
  for (const a of (data || []) as any[]) {
    const { transfer_id, item_id, unit_cost, ...rest } = a
    ;(out[item_id] ||= []).push(withCost(transfer_id) ? { ...rest, unit_cost: unit_cost == null ? null : Number(unit_cost) } : rest)
  }
  return out
}

/** Noms des personnes (créé, envoyé, reçu, annulé par) */
export async function loadNames(admin: any, ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const list = Array.from(new Set(ids.filter(Boolean))) as string[]
  if (!list.length) return {}
  const { data } = await admin.from('profiles').select('id, full_name').in('id', list)
  return Object.fromEntries(((data || []) as any[]).map(p => [p.id, p.full_name || '']))
}

// ── QR ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)
const TOKEN = /^[0-9a-f]{64}$/

/** Contenu du QR : une adresse qui ouvre l'écran de réception (appareil photo ou scanner de l'application) */
export function transferQrUrl(origin: string, locale: string, transferId: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/${locale}/stock/transfers/${transferId}/receive?k=${token}`
}

/** Lit un QR scanné : adresse de réception, ou « STKTR:<id>:<jeton> ». null si ce n'est pas un QR de transfert. */
export function parseTransferCode(code: unknown): { transferId: string; token: string } | null {
  const raw = String(code || '').trim()
  let m = raw.match(/\/stock\/transfers\/([0-9a-f-]{36})\/receive\?(?:.*&)?k=([0-9a-f]{64})(?:&|$)/i)
  if (!m) m = raw.match(/^STKTR:([0-9a-f-]{36}):([0-9a-f]{64})$/i)
  if (!m || !isUuid(m[1]) || !TOKEN.test(m[2].toLowerCase())) return null
  return { transferId: m[1].toLowerCase(), token: m[2].toLowerCase() }
}

/** Comparaison en temps constant de deux jetons (chaînes hexadécimales de même longueur) */
export function sameToken(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
