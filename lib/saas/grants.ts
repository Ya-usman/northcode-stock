// Gestes commerciaux (migration 157) — RÈGLE UNIQUE des limites offertes.
// limite effective = limite de la formule + gestes actifs (non retirés, non
// expirés). « Illimité » (-1) reste illimité. Serveur : client admin.

export type GrantKind = 'team_seats' | 'shops'

export interface EntityGrant {
  id: string
  entity_id: string
  kind: GrantKind
  quantity: number
  reason: string
  granted_by: string | null
  granted_at: string
  expires_at: string | null
  revoked_at: string | null
  revoked_by: string | null
  revoke_reason: string | null
}

export interface GrantBonus { team_seats: number; shops: number }

export function isGrantActive(g: Pick<EntityGrant, 'revoked_at' | 'expires_at'>, now = new Date()): boolean {
  return !g.revoked_at && (!g.expires_at || new Date(g.expires_at) > now)
}

export function sumBonus(grants: Pick<EntityGrant, 'kind' | 'quantity' | 'revoked_at' | 'expires_at'>[], now = new Date()): GrantBonus {
  const b: GrantBonus = { team_seats: 0, shops: 0 }
  for (const g of grants) if (isGrantActive(g, now)) b[g.kind] += g.quantity
  return b
}

/** Limite de la formule + offert ; -1 (illimité) reste -1 */
export function effectiveLimit(planLimit: number, bonus: number): number {
  return planLimit === -1 ? -1 : planLimit + Math.max(0, bonus)
}

/** Gestes actifs d'une entreprise. Table absente (migration 157 non appliquée) → aucun geste. */
export async function getGrantBonus(admin: any, entityId: string): Promise<GrantBonus> {
  const { data, error } = await admin.from('entity_grants')
    .select('kind, quantity, revoked_at, expires_at').eq('entity_id', entityId).is('revoked_at', null)
  if (error) return { team_seats: 0, shops: 0 }
  return sumBonus(data || [])
}

export type GrantInputError = 'invalid_kind' | 'invalid_quantity' | 'reason_required' | 'invalid_expiry'

export function validateGrantInput(body: any, now = new Date()):
  { ok: true; kind: GrantKind; quantity: number; reason: string; expires_at: string | null } | { ok: false; error: GrantInputError } {
  const kind = body?.kind
  if (kind !== 'team_seats' && kind !== 'shops') return { ok: false, error: 'invalid_kind' }
  const quantity = Number(body?.quantity)
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) return { ok: false, error: 'invalid_quantity' }
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : ''
  if (reason.length < 3 || reason.length > 300) return { ok: false, error: 'reason_required' }
  let expires_at: string | null = null
  if (body?.expires_at) {
    const d = new Date(body.expires_at)
    if (Number.isNaN(d.getTime()) || d <= now) return { ok: false, error: 'invalid_expiry' }
    expires_at = d.toISOString()
  }
  return { ok: true, kind, quantity, reason, expires_at }
}
