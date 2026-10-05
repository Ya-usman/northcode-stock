// Quota d'équipe — RÈGLE UNIQUE (décision du 5 oct. 2026) :
//   1 personne distincte = 1 membre d'équipe, quel que soit le nombre de
//   boutiques du compte auxquelles elle est affectée.
//   Le propriétaire du compte n'est PAS compté (règle serveur existante :
//   invitation et contrôle après paiement l'excluaient déjà ; seul l'ancien
//   bandeau le comptait, il est aligné ici).
//
// Utilisée par : invitation, affectation d'un membre existant, bandeau
// (GET /api/team/quota), contrôle après paiement / changement de formule
// (lib/saas/enforce-limits.ts). Aucune autre méthode de comptage ne doit
// exister.
//
// Serveur uniquement : passer un client admin (service role) pour voir toutes
// les affectations du compte, quel que soit l'appelant.

import { getPlan } from './plans'
import { getOwnerShopIds } from '@/lib/api/shop-auth'

export interface TeamSeats {
  ownerId: string
  plan: string
  planName: string
  /** -1 = illimité */
  limit: number
  used: number
  /** Personnes comptées (user_id distincts) */
  personIds: string[]
  /** Boutiques du compte prises en compte (non supprimées, non suspendues par la formule) */
  shopIds: string[]
}

/** Propriétaire du compte auquel appartient une boutique (affectation « owner », sinon shops.owner_id) */
export async function resolveAccountOwnerId(admin: any, shopId: string): Promise<string | null> {
  const { data: ownerRow } = await admin
    .from('shop_members').select('user_id')
    .eq('shop_id', shopId).eq('role', 'owner').eq('is_active', true)
    .order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (ownerRow?.user_id) return ownerRow.user_id
  const { data: shop } = await admin.from('shops').select('owner_id').eq('id', shopId).maybeSingle()
  return shop?.owner_id ?? null
}

/** Boutiques du compte : non supprimées ; `includeSuspended` pour garder celles suspendues par la formule */
export async function getAccountShopIds(admin: any, ownerId: string, opts?: { includeSuspended?: boolean }): Promise<string[]> {
  const ids = await getOwnerShopIds(admin, ownerId)
  if (!ids.length) return []
  let q = admin.from('shops').select('id').in('id', ids).is('deleted_at', null)
  if (!opts?.includeSuspended) q = q.eq('suspended_by_plan', false)
  const { data } = await q
  return (data || []).map((s: any) => s.id)
}

/** Sièges utilisés par le compte : personnes distinctes actives hors propriétaire */
export async function countTeamSeats(admin: any, ownerId: string): Promise<TeamSeats> {
  const [{ data: ownerProfile }, shopIds] = await Promise.all([
    admin.from('profiles').select('plan').eq('id', ownerId).maybeSingle(),
    getAccountShopIds(admin, ownerId),
  ])
  const plan = getPlan(ownerProfile?.plan)
  let personIds: string[] = []
  if (shopIds.length) {
    const { data: rows } = await admin
      .from('shop_members').select('user_id, role')
      .in('shop_id', shopIds).eq('is_active', true)
    personIds = Array.from(new Set(
      (rows || []).filter((r: any) => r.role !== 'owner' && r.user_id !== ownerId).map((r: any) => r.user_id as string)
    ))
  }
  return {
    ownerId,
    plan: plan.id,
    planName: plan.name,
    limit: plan.limits.team_members,
    used: personIds.length,
    personIds,
    shopIds,
  }
}

/**
 * Un siège est-il disponible pour ajouter cette personne au compte ?
 * Une personne déjà comptée (active dans une autre boutique du compte) ne
 * consomme pas de nouveau siège.
 */
export async function checkTeamSeat(admin: any, ownerId: string, userId?: string | null): Promise<{ ok: boolean; seats: TeamSeats }> {
  const seats = await countTeamSeats(admin, ownerId)
  if (seats.limit === -1) return { ok: true, seats }
  if (userId && seats.personIds.includes(userId)) return { ok: true, seats }
  return { ok: seats.used < seats.limit, seats }
}
