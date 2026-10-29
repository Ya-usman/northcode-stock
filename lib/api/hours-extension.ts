// ── Prolongation des horaires et demandes de prolongation, côté SERVEUR (décisions du 29 oct. 2026) ──────────────
// Une demande : un employé d'une boutique fermée APRÈS sa fermeture du jour (ni avant l'ouverture, ni fermée par le
// propriétaire) demande 30 min, 1 h ou 2 h ; le propriétaire et les personnes qui ont le droit « Prolonger »
// (extend_hours) sont prévenus et acceptent ou refusent. Base : migration 186 (table hours_extension_requests,
// fonctions grant_hours_extension / approve_hours_extension_request) ; tant qu'elle n'est pas appliquée, les demandes
// sont indisponibles (requestsUnavailable) et rien d'autre ne change.
import { resolvePermission, type StoredPermissions } from '@/lib/permissions'
import { shopClosedPhase, type ClosedPhase } from '@/lib/saas/shop-hours'

export const REQUEST_MINUTES: readonly number[] = [30, 60, 120]
export const EXTEND_MINUTES: readonly number[] = [15, 30, 45, 60, 120]

/** Erreurs codées de la base (migration 186) → clés de traduction api_errors */
const ERROR_KEYS: Record<string, string> = {
  P0050: 'extension_invalid_duration', P0051: 'extension_hours_not_set', P0052: 'extension_manual_override',
  P0053: 'extension_daily_limit', P0054: 'extension_too_late', P0055: 'extension_request_closed',
}
export function extensionErrorKey(err: any): string | null {
  return ERROR_KEYS[String(err?.code || '')] ?? null
}

/** La table des demandes n'existe pas encore (migration 186 non appliquée) */
export function requestsUnavailable(err: any): boolean {
  const msg = String(err?.message || '')
  return err?.code === '42P01' || err?.code === 'PGRST205' || (/hours_extension_requests/.test(msg) && /does not exist|schema cache|Could not find/i.test(msg))
}

/** Peut accepter une demande : propriétaire (ou super admin), ou rôle avec le droit « Prolonger » en modification */
export function canApproveExtension(role: string | null | undefined, stored: StoredPermissions | null): boolean {
  if (!role) return false
  if (role === 'owner' || role === 'super_admin') return true
  return resolvePermission(stored, role, 'extend_hours').write
}

/** Personnes (adhésions actives) qui peuvent accepter les demandes de cette boutique */
export async function approverIds(admin: any, shopId: string): Promise<string[]> {
  const [{ data: members }, { data: shop }] = await Promise.all([
    admin.from('shop_members').select('user_id, role').eq('shop_id', shopId).eq('is_active', true),
    admin.from('shops').select('role_permissions').eq('id', shopId).maybeSingle(),
  ])
  const stored = (shop?.role_permissions as StoredPermissions | null) ?? null
  return ((members || []) as { user_id: string; role: string }[]).filter(m => canApproveExtension(m.role, stored)).map(m => m.user_id)
}

export interface ShopHoursRow {
  hours_enabled: boolean | null; opening_time: string | null; closing_time: string | null
  hours_manual_override: 'open' | 'closed' | null; hours_extension_until: string | null; timezone: string | null
}

/** Moment de la fermeture, à l'heure de la boutique */
export function phaseOf(s: ShopHoursRow, now = new Date()): ClosedPhase {
  return shopClosedPhase(s.hours_enabled, s.opening_time, s.closing_time, s.hours_manual_override, s.hours_extension_until, now, s.timezone)
}

export const HOURS_COLUMNS = 'id, name, hours_enabled, opening_time, closing_time, hours_manual_override, hours_extension_until, timezone, role_permissions'
