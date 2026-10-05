// Abonnement d'une boutique = celui de son ENTREPRISE (migration 153, 5 oct.
// 2026). Avant : celui du profil personnel de son propriétaire (migrations 047
// et 106). Chaque consommateur de `Shop` (contexte, admin, exports) reçoit
// toujours plan / plan_expires_at / trial_ends_at, sans colonne dupliquée sur
// shops — résolus ici, à un seul endroit.
//
// Source unique : l'entreprise (migration 153). Plus de repli sur le profil du
// propriétaire (copie retirée par la migration 154).
export async function attachOwnerPlan(
  supabase: any,
  shops: Array<{ owner_id?: string | null; entity_id?: string | null; entity_name?: string | null; plan?: any; plan_expires_at?: any; trial_ends_at?: any }>,
): Promise<void> {
  if (!shops.length) return

  const entityIds = Array.from(new Set(shops.map(s => s.entity_id).filter(Boolean))) as string[]
  const byEntity = new Map<string, any>()
  if (entityIds.length) {
    const { data: entities, error } = await supabase
      .from('entities')
      .select('id, name, plan, plan_expires_at, trial_ends_at')
      .in('id', entityIds)
    if (!error) for (const e of entities ?? []) byEntity.set(e.id, e)
  }

  for (const shop of shops) {
    const source = shop.entity_id ? byEntity.get(shop.entity_id) : undefined
    shop.plan = source?.plan ?? 'trial'
    shop.plan_expires_at = source?.plan_expires_at ?? null
    shop.trial_ends_at = source?.trial_ends_at ?? null
    if (shop.entity_id && byEntity.has(shop.entity_id)) shop.entity_name = byEntity.get(shop.entity_id).name
  }
}
