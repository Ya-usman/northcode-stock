// Quota d'équipe — RÈGLE UNIQUE (décision du 5 oct. 2026), portée par
// l'ENTREPRISE (migration 153) :
//   1 personne distincte = 1 membre d'équipe, quel que soit le nombre de
//   boutiques de l'entreprise auxquelles elle est affectée.
//   Le propriétaire de l'entreprise n'est PAS compté.
//
// Limite = formule + gestes commerciaux actifs (lib/saas/grants.ts).
//
// Utilisée par : invitation, affectation d'un membre existant, réactivation
// de compte, bandeau et page Abonnement (GET /api/team/quota), contrôle après
// paiement (lib/saas/enforce-limits.ts). Aucune autre méthode de comptage.
//
// Serveur uniquement : passer un client admin (service role).

import { getPlan } from './plans'
import { getAccountForShop, getEntityShopIds, type EntityAccount } from './entity'
import { getGrantBonus, effectiveLimit } from './grants'

export type { EntityAccount }

export interface TeamSeats {
  entityId: string
  ownerId: string | null
  plan: string
  planName: string
  /** Limite effective = formule + gestes commerciaux actifs (migration 157) ; -1 = illimité */
  limit: number
  /** Limite de la formule seule */
  planLimit: number
  /** Membres offerts (gestes actifs) */
  offered: number
  used: number
  /** Personnes comptées (user_id distincts) */
  personIds: string[]
  /** Boutiques de l'entreprise prises en compte (non supprimées, non suspendues par la formule) */
  shopIds: string[]
}

/** Entreprise (compte) d'une boutique : identifiant, propriétaire, abonnement */
export const resolveAccount = getAccountForShop

/** Boutiques de l'entreprise */
export function getAccountShopIds(admin: any, account: Pick<EntityAccount, 'entityId'>, opts?: { includeSuspended?: boolean }): Promise<string[]> {
  return getEntityShopIds(admin, account, opts)
}

/** Sièges utilisés par l'entreprise : personnes distinctes actives hors propriétaire */
export async function countTeamSeats(admin: any, account: EntityAccount): Promise<TeamSeats> {
  const plan = getPlan(account.plan)
  const [shopIds, bonus] = await Promise.all([getEntityShopIds(admin, account), getGrantBonus(admin, account.entityId)])
  let personIds: string[] = []
  if (shopIds.length) {
    const { data: rows } = await admin
      .from('shop_members').select('user_id, role')
      .in('shop_id', shopIds).eq('is_active', true)
    personIds = Array.from(new Set(
      (rows || []).filter((r: any) => r.role !== 'owner' && r.user_id !== account.ownerId).map((r: any) => r.user_id as string)
    ))
  }
  return {
    entityId: account.entityId,
    ownerId: account.ownerId,
    plan: plan.id,
    planName: plan.name,
    limit: effectiveLimit(plan.limits.team_members, bonus.team_seats),
    planLimit: plan.limits.team_members,
    offered: plan.limits.team_members === -1 ? 0 : bonus.team_seats,
    used: personIds.length,
    personIds,
    shopIds,
  }
}

/** Limite de boutiques de l'entreprise : formule + boutiques offertes ; -1 = illimité */
export async function getShopLimit(admin: any, account: Pick<EntityAccount, 'entityId' | 'plan'>): Promise<{ limit: number; planLimit: number; offered: number }> {
  const planLimit = getPlan(account.plan).limits.shops
  const bonus = await getGrantBonus(admin, account.entityId)
  return { limit: effectiveLimit(planLimit, bonus.shops), planLimit, offered: planLimit === -1 ? 0 : bonus.shops }
}

/**
 * Un siège est-il disponible pour ajouter cette personne à l'entreprise ?
 * Une personne déjà comptée (active dans une autre boutique de l'entreprise)
 * ne consomme pas de nouveau siège.
 */
export async function checkTeamSeat(admin: any, account: EntityAccount, userId?: string | null): Promise<{ ok: boolean; seats: TeamSeats }> {
  const seats = await countTeamSeats(admin, account)
  if (seats.limit === -1) return { ok: true, seats }
  if (userId && seats.personIds.includes(userId)) return { ok: true, seats }
  return { ok: seats.used < seats.limit, seats }
}
