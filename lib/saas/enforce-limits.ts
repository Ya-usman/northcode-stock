import { getPlan } from './plans'
import { writeAuditLog } from '@/lib/api/audit'
import { getAccountShopIds } from './team-quota'

export interface EnforcementResult {
  /** true = calcul seul, rien n'a été écrit (voir PLAN_LIMIT_ENFORCEMENT) */
  dry_run:             boolean
  suspended_shops:     string[]  // shop ids newly suspended
  reactivated_shops:   string[]  // shop ids newly reactivated
  suspended_members:   string[]  // shop_member ids newly suspended
  reactivated_members: string[]  // shop_member ids newly reactivated
}

/**
 * Applique les limites de la formule d'un propriétaire (après paiement,
 * abonnement, ou sur demande).
 *
 * Refonte du 5 oct. 2026 :
 *  - Boutique « active » = non supprimée ET non suspendue par la formule
 *    (`shops.suspended_by_plan`). L'ancienne version filtrait `shops.is_active`,
 *    colonne qui n'existe pas : la requête échouait et RIEN n'était jamais
 *    suspendu ni réactivé.
 *  - Membres : règle unique de lib/saas/team-quota.ts — 1 personne distincte =
 *    1 membre, propriétaire non compté. Une personne en trop est suspendue
 *    dans TOUTES les boutiques du compte (affectations marquées
 *    suspended_by_plan pour pouvoir les rendre à l'identique).
 *  - Ordre : on garde les plus anciens (boutique créée / personne arrivée en
 *    premier) ; on réactive d'abord les plus anciens suspendus.
 *
 * SÉCURITÉ : tant que la variable d'environnement PLAN_LIMIT_ENFORCEMENT ne
 * vaut pas « on », la fonction CALCULE seulement (dry_run) et n'écrit rien —
 * aucun client réel ne peut être suspendu avant validation explicite.
 */
export async function enforceOwnerPlanLimits(
  supabase: any,
  owner_id: string,
): Promise<EnforcementResult> {
  const dryRun = process.env.PLAN_LIMIT_ENFORCEMENT !== 'on'
  const result: EnforcementResult = {
    dry_run: dryRun,
    suspended_shops:   [],
    reactivated_shops: [],
    suspended_members: [],
    reactivated_members: [],
  }

  const { data: ownerProfile } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', owner_id)
    .single()
  if (!ownerProfile) return result

  const plan = getPlan(ownerProfile.plan)
  const shopLimit   = plan.limits.shops        // -1 = illimité
  const memberLimit = plan.limits.team_members // -1 = illimité ; propriétaire non compté

  // ── 1. BOUTIQUES ──────────────────────────────────────────────────────────
  const allShopIds = await getAccountShopIds(supabase, owner_id, { includeSuspended: true })
  const { data: allShops } = allShopIds.length
    ? await supabase.from('shops')
        .select('id, suspended_by_plan, created_at')
        .in('id', allShopIds)
        .order('created_at', { ascending: true })
    : { data: [] }

  if (allShops && shopLimit !== -1) {
    const activeShops    = allShops.filter((s: any) => !s.suspended_by_plan)
    const suspendedShops = allShops.filter((s: any) => s.suspended_by_plan)

    if (activeShops.length > shopLimit) {
      // Les plus récentes d'abord
      const toSuspend = activeShops.slice(shopLimit).reverse()
      for (const shop of toSuspend) {
        if (!dryRun) {
          await supabase.from('shops').update({ suspended_by_plan: true }).eq('id', shop.id)
          // Employés de cette boutique (le propriétaire garde son accès)
          await supabase.from('shop_members')
            .update({ is_active: false, suspended_by_plan: true })
            .eq('shop_id', shop.id).eq('is_active', true).neq('role', 'owner')
        }
        result.suspended_shops.push(shop.id)
      }
    } else if (activeShops.length < shopLimit && suspendedShops.length > 0) {
      const toReactivate = suspendedShops.slice(0, shopLimit - activeShops.length)
      for (const shop of toReactivate) {
        if (!dryRun) {
          await supabase.from('shops').update({ suspended_by_plan: false }).eq('id', shop.id)
          await supabase.from('shop_members')
            .update({ is_active: true, suspended_by_plan: false })
            .eq('shop_id', shop.id).eq('suspended_by_plan', true)
        }
        result.reactivated_shops.push(shop.id)
      }
    }
  }

  // ── 2. MEMBRES (personnes distinctes) ─────────────────────────────────────
  if (memberLimit !== -1) {
    // Boutiques qui restent actives après l'étape 1
    const activeIds = (allShops || [])
      .filter((s: any) => (!s.suspended_by_plan && !result.suspended_shops.includes(s.id)) || result.reactivated_shops.includes(s.id))
      .map((s: any) => s.id)

    if (activeIds.length > 0) {
      const { data: rows } = await supabase
        .from('shop_members')
        .select('id, shop_id, user_id, role, is_active, suspended_by_plan, created_at')
        .in('shop_id', activeIds)
        .neq('role', 'owner')
        .neq('user_id', owner_id)
        .order('created_at', { ascending: true })

      // Personnes actives : ordre d'arrivée = première affectation active
      const activeRows = (rows || []).filter((r: any) => r.is_active)
      const suspendedRows = (rows || []).filter((r: any) => !r.is_active && r.suspended_by_plan)
      const activePersons: string[] = []
      for (const r of activeRows) if (!activePersons.includes(r.user_id)) activePersons.push(r.user_id)

      if (activePersons.length > memberLimit) {
        const excess = activePersons.slice(memberLimit)
        const ids = activeRows.filter((r: any) => excess.includes(r.user_id)).map((r: any) => r.id)
        if (ids.length) {
          if (!dryRun) {
            await supabase.from('shop_members')
              .update({ is_active: false, suspended_by_plan: true })
              .in('id', ids)
          }
          result.suspended_members.push(...ids)
        }
      } else if (activePersons.length < memberLimit && suspendedRows.length > 0) {
        const waiting: string[] = []
        for (const r of suspendedRows) if (!waiting.includes(r.user_id) && !activePersons.includes(r.user_id)) waiting.push(r.user_id)
        const back = waiting.slice(0, memberLimit - activePersons.length)
        // Une personne déjà active ailleurs ne consomme pas de siège : on lui rend aussi ses affectations suspendues
        const ids = suspendedRows.filter((r: any) => back.includes(r.user_id) || activePersons.includes(r.user_id)).map((r: any) => r.id)
        if (ids.length) {
          if (!dryRun) {
            await supabase.from('shop_members')
              .update({ is_active: true, suspended_by_plan: false })
              .in('id', ids)
          }
          result.reactivated_members.push(...ids)
        }
      }
    }
  }

  // ── Journal ───────────────────────────────────────────────────────────────
  const anythingHappened =
    result.suspended_shops.length   > 0 ||
    result.reactivated_shops.length > 0 ||
    result.suspended_members.length > 0 ||
    result.reactivated_members.length > 0

  if (anythingHappened && !dryRun) {
    await writeAuditLog({
      action: 'billing.limit_enforced',
      actor_id: owner_id,
      metadata: {
        plan: plan.id,
        suspended_shops:     result.suspended_shops.length,
        reactivated_shops:   result.reactivated_shops.length,
        suspended_members:   result.suspended_members.length,
        reactivated_members: result.reactivated_members.length,
      },
    })
  }

  return result
}
