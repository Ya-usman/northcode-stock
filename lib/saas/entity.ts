// L'ENTREPRISE (entity) — racine du compte (migration 153, 5 oct. 2026).
// Module serveur UNIQUE pour : retrouver l'entreprise d'une boutique, lire et
// écrire son abonnement. Toujours appelé avec un client admin (service role).
//
// USER = personne · ENTITY = entreprise cliente (abonnement, facturation,
// membres, paramètres) · SHOP = établissement. Le rôle technique « owner »
// désigne la PERSONNE propriétaire de l'entreprise.
//
// Source unique de l'abonnement : l'entreprise. Aucune lecture ni écriture du
// plan sur le profil du propriétaire (copie de transition retirée par la
// migration 154).

export interface EntityPlan {
  plan: string
  plan_expires_at: string | null
  trial_ends_at: string | null
  plan_grace_ends_at: string | null
}

export interface EntityAccount extends EntityPlan {
  entityId: string
  /** Personne propriétaire (entities.owner_user_id) */
  ownerId: string | null
  name: string | null
  is_internal: boolean
  billing_country: string | null
}

/** Entreprise d'une boutique, avec son propriétaire et son abonnement (null si boutique ou entreprise introuvable) */
export async function getAccountForShop(admin: any, shopId: string): Promise<EntityAccount | null> {
  const { data: shop } = await admin.from('shops').select('id, entity_id, country, billing_country').eq('id', shopId).maybeSingle()
  if (!shop?.entity_id) return null
  const { data: e } = await admin.from('entities')
    .select('id, name, owner_user_id, plan, plan_expires_at, trial_ends_at, plan_grace_ends_at, is_internal, billing_country')
    .eq('id', shop.entity_id).maybeSingle()
  if (!e) return null
  return {
    entityId: e.id, ownerId: e.owner_user_id, name: e.name,
    plan: e.plan || 'trial', plan_expires_at: e.plan_expires_at, trial_ends_at: e.trial_ends_at, plan_grace_ends_at: e.plan_grace_ends_at,
    is_internal: !!e.is_internal, billing_country: e.billing_country || shop.billing_country || shop.country,
  }
}

/** Écrit l'abonnement de l'entreprise (seule source de vérité) */
export async function setAccountPlan(admin: any, account: Pick<EntityAccount, 'entityId'>, fields: Partial<EntityPlan>): Promise<{ error: any }> {
  const { error } = await admin.from('entities').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', account.entityId)
  return { error }
}

/** Boutiques de l'entreprise (non supprimées ; `includeSuspended` pour garder celles suspendues par la formule) */
export async function getEntityShopIds(admin: any, account: Pick<EntityAccount, 'entityId'>, opts?: { includeSuspended?: boolean }): Promise<string[]> {
  let q = admin.from('shops').select('id').eq('entity_id', account.entityId).is('deleted_at', null)
  if (!opts?.includeSuspended) q = q.eq('suspended_by_plan', false)
  const { data } = await q
  return (data || []).map((s: any) => s.id)
}
