import { getPlan } from './plans'
import { writeAuditLog } from '@/lib/api/audit'

export interface EnforcementResult {
  suspended_shops:     string[]  // shop ids newly suspended
  reactivated_shops:   string[]  // shop ids newly reactivated
  suspended_members:   string[]  // shop_member ids newly suspended
  reactivated_members: string[]  // shop_member ids newly reactivated
}

/**
 * Enforce plan limits for a given owner after a plan change.
 *
 * Suspension order: newest first (oldest shops/members are kept active first).
 * Reactivation order: oldest suspended first (they were the last ones suspended).
 *
 * Called from /api/billing/verify after every successful payment, and from
 * /api/billing/enforce-limits for on-demand checks.
 */
export async function enforceOwnerPlanLimits(
  supabase: any,
  owner_id: string,
): Promise<EnforcementResult> {
  const result: EnforcementResult = {
    suspended_shops:   [],
    reactivated_shops: [],
    suspended_members: [],
    reactivated_members: [],
  }

  // ── Fetch owner profile to read current plan ───────────────────────────────
  const { data: ownerProfile } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', owner_id)
    .single()

  if (!ownerProfile) return result

  const plan = getPlan(ownerProfile.plan)
  const shopLimit    = plan.limits.shops        // -1 = unlimited
  const memberLimit  = plan.limits.team_members // -1 = unlimited; owner doesn't count

  // ── 1. SHOPS ──────────────────────────────────────────────────────────────
  // Fetch all non-deleted shops owned by this user, ordered oldest → newest
  const { data: allShops } = await supabase
    .from('shops')
    .select('id, is_active, suspended_by_plan, created_at')
    .eq('owner_id', owner_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true })

  if (allShops && shopLimit !== -1) {
    const activeShops    = allShops.filter((s: any) => s.is_active)
    const suspendedShops = allShops.filter((s: any) => !s.is_active && s.suspended_by_plan)

    if (activeShops.length > shopLimit) {
      // Suspend excess — newest active shops first
      const toSuspend = activeShops.slice(shopLimit).reverse()
      for (const shop of toSuspend) {
        await supabase.from('shops')
          .update({ is_active: false, suspended_by_plan: true })
          .eq('id', shop.id)

        // Deactivate all non-owner members of this shop
        await supabase.from('shop_members')
          .update({ is_active: false, suspended_by_plan: true })
          .eq('shop_id', shop.id)
          .neq('role', 'owner')

        result.suspended_shops.push(shop.id)
      }
    } else if (activeShops.length < shopLimit && suspendedShops.length > 0) {
      // Plan upgrade: reactivate oldest suspended shops first
      const slots = shopLimit - activeShops.length
      const toReactivate = suspendedShops.slice(0, slots)
      for (const shop of toReactivate) {
        await supabase.from('shops')
          .update({ is_active: true, suspended_by_plan: false })
          .eq('id', shop.id)

        // Reactivate members that were suspended because of this shop
        await supabase.from('shop_members')
          .update({ is_active: true, suspended_by_plan: false })
          .eq('shop_id', shop.id)
          .eq('suspended_by_plan', true)

        result.reactivated_shops.push(shop.id)
      }
    }
  }

  // ── 2. TEAM MEMBERS ───────────────────────────────────────────────────────
  // Count only active non-owner members across all active shops
  if (memberLimit !== -1) {
    const { data: activeShopIds } = await supabase
      .from('shops')
      .select('id')
      .eq('owner_id', owner_id)
      .eq('is_active', true)
      .is('deleted_at', null)

    const ids = (activeShopIds || []).map((s: any) => s.id)

    if (ids.length > 0) {
      const { data: activeMembers } = await supabase
        .from('shop_members')
        .select('id, shop_id, created_at')
        .in('shop_id', ids)
        .eq('is_active', true)
        .eq('suspended_by_plan', false)
        .not('role', 'eq', 'owner')
        .order('created_at', { ascending: true })

      const { data: suspendedMembers } = await supabase
        .from('shop_members')
        .select('id, shop_id, created_at')
        .in('shop_id', ids)
        .eq('is_active', false)
        .eq('suspended_by_plan', true)
        .not('role', 'eq', 'owner')
        .order('created_at', { ascending: true })

      if ((activeMembers || []).length > memberLimit) {
        const toSuspend = (activeMembers as any[]).slice(memberLimit).reverse()
        const memberIds = toSuspend.map((m: any) => m.id)
        if (memberIds.length > 0) {
          await supabase.from('shop_members')
            .update({ is_active: false, suspended_by_plan: true })
            .in('id', memberIds)
          result.suspended_members.push(...memberIds)
        }
      } else if ((activeMembers || []).length < memberLimit && (suspendedMembers || []).length > 0) {
        const slots = memberLimit - (activeMembers || []).length
        const toReactivate = (suspendedMembers as any[]).slice(0, slots)
        const memberIds = toReactivate.map((m: any) => m.id)
        if (memberIds.length > 0) {
          await supabase.from('shop_members')
            .update({ is_active: true, suspended_by_plan: false })
            .in('id', memberIds)
          result.reactivated_members.push(...memberIds)
        }
      }
    }
  }

  // ── Audit log ─────────────────────────────────────────────────────────────
  const anythingHappened =
    result.suspended_shops.length   > 0 ||
    result.reactivated_shops.length > 0 ||
    result.suspended_members.length > 0 ||
    result.reactivated_members.length > 0

  if (anythingHappened) {
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
