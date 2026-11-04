// Quota d'équipe — RÈGLE UNIQUE (décision du 5 oct. 2026), portée par
// l'ENTREPRISE (migration 153) :
//   1 personne distincte = 1 membre d'équipe, quel que soit le nombre de
//   boutiques de l'entreprise auxquelles elle est affectée.
//   Le propriétaire de l'entreprise n'est PAS compté.
//
// Limite = formule (anciennes limites des clients actuels comprises, lib/saas/legacy-terms) + gestes commerciaux
// actifs (lib/saas/grants.ts) + options payées (lib/saas/addons.ts, migration 210).
//
// Utilisée par : invitation, affectation d'un membre existant, réactivation
// de compte, bandeau et page Abonnement (GET /api/team/quota), contrôle après
// paiement (lib/saas/enforce-limits.ts). Aucune autre méthode de comptage.
//
// Serveur uniquement : passer un client admin (service role).

import { getPlan } from './plans'
import { getAccountForShop, getEntityShopIds, type EntityAccount } from './entity'
import { getGrantBonus, effectiveLimit } from './grants'
import { getLegacyTerms, planLimitWithLegacy } from './legacy-terms'
import { activeAddons, getEntityAddons } from './addons'
import { customLimit, getEntityCustom } from './custom-plan'

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
  /** Employés en plus payés (options) */
  purchased: number
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
  const [shopIds, bonus, legacy, addons, custom] = await Promise.all([getEntityShopIds(admin, account), getGrantBonus(admin, account.entityId), getLegacyTerms(admin, account.entityId), getEntityAddons(admin, account.entityId), getEntityCustom(admin, account.entityId)])
  // Offre sur mesure (migration 211) : limites du devis payé, Business seulement
  const planLimit = customLimit(planLimitWithLegacy(plan.limits.team_members, plan.id, legacy, 'team_members'), plan.id, custom, 'team_members')
  const purchased = planLimit === -1 ? 0 : activeAddons(plan.id, addons).seats
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
    limit: effectiveLimit(planLimit, bonus.team_seats + purchased),
    planLimit,
    offered: planLimit === -1 ? 0 : bonus.team_seats,
    purchased,
    used: personIds.length,
    personIds,
    shopIds,
  }
}

/** Limite de boutiques de l'entreprise : formule + boutiques offertes + boutiques payées (options) ; -1 = illimité */
export async function getShopLimit(admin: any, account: Pick<EntityAccount, 'entityId' | 'plan'>): Promise<{ limit: number; planLimit: number; offered: number; purchased: number }> {
  const plan = getPlan(account.plan)
  const [bonus, legacy, addons, custom] = await Promise.all([getGrantBonus(admin, account.entityId), getLegacyTerms(admin, account.entityId), getEntityAddons(admin, account.entityId), getEntityCustom(admin, account.entityId)])
  const planLimit = customLimit(planLimitWithLegacy(plan.limits.shops, plan.id, legacy, 'shops'), plan.id, custom, 'shops')
  const purchased = planLimit === -1 ? 0 : activeAddons(plan.id, addons).shops
  return { limit: effectiveLimit(planLimit, bonus.shops + purchased), planLimit, offered: planLimit === -1 ? 0 : bonus.shops, purchased }
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
