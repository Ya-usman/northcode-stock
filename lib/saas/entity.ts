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

import { CLEAR_NEXT, NEXT_COLUMNS, effectivePlan } from './plan-change'

export interface EntityPlan {
  plan: string
  plan_expires_at: string | null
  trial_ends_at: string | null
  plan_grace_ends_at: string | null
}

export interface EntityAccount extends EntityPlan {
  entityId: string
  /** Changement de formule programmé (migration 212) ; absent si la colonne n'existe pas encore */
  next_plan?: string | null
  next_plan_from?: string | null
  next_plan_until?: string | null
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
  const BASE = 'id, name, owner_user_id, plan, plan_expires_at, trial_ends_at, plan_grace_ends_at, is_internal, billing_country'
  // Avec le changement programmé (migration 212) ; colonnes absentes : lecture d'avant
  let { data: e, error } = await admin.from('entities').select(`${BASE}, ${NEXT_COLUMNS}`).eq('id', shop.entity_id).maybeSingle()
  if (error) ({ data: e } = await admin.from('entities').select(BASE).eq('id', shop.entity_id).maybeSingle())
  if (!e) return null
  // Changement programmé arrivé à sa date : appliqué ici (écriture conditionnée, une seule fois), vue à jour renvoyée.
  // Mise en pause de ce qui dépasse la nouvelle formule : tâche du matin (grant-reminders) ; pas ici, ce module est
  // aussi lu par des pages du navigateur (via plan-features) et enforce-limits est réservé au serveur.
  const eff = effectivePlan(e)
  if (eff.switched) await applyScheduledPlan(admin, e).catch(() => false)
  return {
    entityId: e.id, ownerId: e.owner_user_id, name: e.name,
    plan: eff.plan || 'trial', plan_expires_at: eff.plan_expires_at ?? null, trial_ends_at: e.trial_ends_at, plan_grace_ends_at: e.plan_grace_ends_at,
    is_internal: !!e.is_internal, billing_country: e.billing_country || shop.billing_country || shop.country,
    next_plan: eff.switched ? null : e.next_plan ?? null, next_plan_from: eff.switched ? null : e.next_plan_from ?? null, next_plan_until: eff.switched ? null : e.next_plan_until ?? null,
  }
}

/**
 * Bascule d'un changement programmé arrivé à sa date (migration 212) : formule, fin de période et options de la
 * période suivante ; écriture conditionnée au changement lu (une seule bascule même avec des lectures simultanées).
 */
export async function applyScheduledPlan(admin: any, e: { id: string; next_plan?: string | null; next_plan_from?: string | null; next_plan_until?: string | null; next_addon_seats?: number | null; next_addon_shops?: number | null }): Promise<boolean> {
  if (!e.next_plan || !e.next_plan_from || !e.next_plan_until) return false
  const patch: Record<string, unknown> = { plan: e.next_plan, plan_expires_at: e.next_plan_until, trial_ends_at: null, ...CLEAR_NEXT, updated_at: new Date().toISOString() }
  if (e.next_addon_seats != null) { patch.addon_seats = e.next_addon_seats; patch.addon_seats_renew = null }
  if (e.next_addon_shops != null) { patch.addon_shops = e.next_addon_shops; patch.addon_shops_renew = null }
  const { data } = await admin.from('entities').update(patch).eq('id', e.id).eq('next_plan_from', e.next_plan_from).select('id')
  if (!data?.length) return false
  // Trace (insertion directe : lib/api/audit est réservé au serveur) ; la tâche du matin s'en sert pour mettre en pause
  // ce qui dépasse la nouvelle formule quand la bascule a eu lieu à la lecture
  await admin.from('audit_logs').insert({ action: 'billing.plan_switch', target_id: e.id, target_type: 'entity', metadata: { plan: e.next_plan, from: e.next_plan_from, until: e.next_plan_until } }).then(() => {}, () => {})
  return true
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
