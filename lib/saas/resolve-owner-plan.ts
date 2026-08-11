// Plan/trial data lives only on `profiles` (owner-level billing — see
// migration 047). `shops` used to carry a denormalized copy of the same
// fields, which required every billing write path to remember to sync it
// and was a repeat source of drift (see migration 105). This resolves each
// shop's plan from its owner instead, so it can never go stale relative to
// `profiles`.
export async function attachOwnerPlan(
  supabase: any,
  shops: Array<{ owner_id?: string | null; plan?: any; plan_expires_at?: any; trial_ends_at?: any }>,
): Promise<void> {
  const ownerIds = Array.from(new Set(shops.map(s => s.owner_id).filter(Boolean))) as string[]
  if (ownerIds.length === 0) return

  const { data: owners } = await supabase
    .from('profiles')
    .select('id, plan, plan_expires_at, trial_ends_at')
    .in('id', ownerIds)

  const byId = new Map<string, any>((owners ?? []).map((o: any) => [o.id, o]))

  for (const shop of shops) {
    const owner = shop.owner_id ? byId.get(shop.owner_id) : undefined
    shop.plan = owner?.plan ?? 'trial'
    shop.plan_expires_at = owner?.plan_expires_at ?? null
    shop.trial_ends_at = owner?.trial_ends_at ?? null
  }
}
