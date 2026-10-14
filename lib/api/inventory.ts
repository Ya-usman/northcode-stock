// ── Inventaire physique (migration 175) : accès commun des routes ───────────────
// Toutes les opérations passent par le serveur : tables et fonctions sont fermées au navigateur. Chaque route
// vérifie l'interrupteur « Inventaire » DANS la boutique demandée ; les fonctions en base vérifient ensuite que
// la session appartient bien à cette boutique (le shop_id envoyé n'autorise rien à lui seul).
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canViewFeature, canWriteFeature } from '@/lib/api/role-permissions'

const UUID = /^[0-9a-f-]{36}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

export async function inventoryAccess(
  t: (key: any) => string, shopId: unknown, mode: 'view' | 'write',
): Promise<{ ok: true; userId: string; admin: any; canWrite: () => Promise<boolean> } | { ok: false; response: NextResponse }> {
  const { user, supabase } = await getAuthedUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: t('not_authenticated') }, { status: 401 }) }
  if (!isUuid(shopId)) return { ok: false, response: NextResponse.json({ error: t('shop_id_required') }, { status: 400 }) }
  const role = await checkShopRole(supabase, user.id, shopId)
  const allowed = role && (mode === 'view'
    ? await canViewFeature(supabase, role, shopId, 'inventory_count')
    : await canWriteFeature(supabase, role, shopId, 'inventory_count'))
  if (!allowed) return { ok: false, response: NextResponse.json({ error: t('permission_denied') }, { status: 403 }) }
  return {
    ok: true, userId: user.id, admin: await createAdminClient(),
    canWrite: async () => mode === 'write' || !!(await canWriteFeature(supabase, role, shopId, 'inventory_count')),
  }
}

// Erreurs levées par les fonctions de la base (raise exception '<code>') → message traduit
const DB_ERRORS: Record<string, string> = {
  session_not_found: 'inventory_session_not_found',
  session_closed: 'inventory_session_closed',
  reason_required: 'inventory_reason_required',
  nothing_counted: 'inventory_nothing_counted',
  invalid_quantity: 'inventory_invalid_quantity',
  product_not_found: 'inventory_product_not_found',
  count_not_found: 'inventory_count_not_found',
  invalid_reason: 'inventory_invalid_reason',
}
export function inventoryDbError(t: (key: any) => string, error: { message?: string } | null | undefined): NextResponse {
  const code = String(error?.message || '').trim()
  const key = DB_ERRORS[code]
  return NextResponse.json({ error: key ? t(key) : (error?.message || 'error'), code: key ? code : undefined }, { status: key ? 400 : 500 })
}

/** Noms affichables des auteurs (les colonnes visent auth.users : pas de jointure directe vers profiles) */
export async function actorNames(admin: any, ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(ids.filter(Boolean))) as string[]
  if (!unique.length) return {}
  const { data } = await admin.from('profiles').select('id, full_name').in('id', unique)
  const map: Record<string, string> = {}
  for (const p of data || []) if (p.full_name) map[p.id] = p.full_name
  return map
}

/** Date du calendrier « AAAA-MM-JJ » réellement existante (le 31/02 est refusé, jamais corrigé) */
export function isRealDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10) === value
}

// Colonnes d'une ligne de comptage envoyées à l'écran (aucun prix, aucun coût : on COMPTE)
export const COUNT_COLUMNS = 'id, product_id, product_name, unit, theoretical_qty, counted_qty, delta, reason_code, surplus_expiry_date, recount_requested_at, counted_by, counted_at, applied_before, applied_after, applied_delta'
