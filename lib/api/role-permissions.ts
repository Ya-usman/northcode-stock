// Côté serveur de la règle unique de permissions (lib/permissions). Lit les
// réglages de la boutique (shops.role_permissions) et applique EXACTEMENT la
// même résolution que l'interface — plus aucune copie locale des défauts.
//
// Routes qui modifient des données → canWriteFeature ; routes de lecture →
// canViewFeature. Un Observateur n'obtient jamais « write ».

import { resolvePermission, isManagerial, canViewCost as canViewCostRule, type PermFeature, type StoredPermissions } from '@/lib/permissions'
import { closedFor } from '@/lib/api/shop-hours'

export type { PermFeature }
export { isManagerial }

async function loadStored(supabase: any, shop_id: string): Promise<StoredPermissions | null> {
  const { data } = await supabase.from('shops').select('role_permissions').eq('id', shop_id).maybeSingle()
  return (data?.role_permissions as StoredPermissions | null) ?? null
}

export async function canViewFeature(supabase: any, role: string | null | undefined, shop_id: string, feature: PermFeature): Promise<boolean> {
  if (!role) return false
  if (role === 'owner' || role === 'super_admin') return true
  return resolvePermission(await loadStored(supabase, shop_id), role, feature).view
}

/**
 * Droit de MODIFIER une fonction. Horaires (29 oct. 2026) : boutique fermée → un employé ne modifie rien (le propriétaire
 * et le super admin, exemptés, sont traités plus haut). Toujours permis fermé : demander une prolongation (extend_hours) ;
 * `ignoreHours` réservé à la synchronisation des ventes faites hors ligne (jamais refusée pour les horaires).
 */
export async function canWriteFeature(supabase: any, role: string | null | undefined, shop_id: string, feature: PermFeature, opts: { ignoreHours?: boolean } = {}): Promise<boolean> {
  if (!role) return false
  if (role === 'owner' || role === 'super_admin') return true
  if (!resolvePermission(await loadStored(supabase, shop_id), role, feature).write) return false
  if (feature === 'extend_hours' || opts.ignoreHours) return true
  return !(await closedFor(shop_id, role))
}

/**
 * Boutiques (parmi shopIds) où la personne est membre active ET a le droit de CONSULTER l'une des fonctions demandées,
 * évalué boutique par boutique avec son rôle DANS cette boutique (jamais le rôle global du profil).
 * Renvoie aussi le rôle par boutique retenue. Lecture des adhésions par le client de la session (RLS).
 */
export async function shopsWithView(
  supabase: any, userId: string, shopIds: string[], features: PermFeature[],
): Promise<{ ids: string[]; roles: Record<string, string> }> {
  const ids = Array.from(new Set(shopIds.filter(Boolean)))
  if (!ids.length) return { ids: [], roles: {} }
  const { data: rows } = await supabase.from('shop_members').select('shop_id, role').in('shop_id', ids).eq('user_id', userId).eq('is_active', true)
  const roles: Record<string, string> = {}
  for (const m of (rows || []) as Array<{ shop_id: string; role: string }>) {
    for (const f of features) {
      if (await canViewFeature(supabase, m.role, m.shop_id, f)) { roles[m.shop_id] = m.role; break }
    }
  }
  return { ids: ids.filter(id => id in roles), roles }
}

/**
 * Ce rôle voit-il les prix d'achat, marges et valeurs de stock de cette boutique ?
 * Règle unique : lib/permissions → canViewCost. À utiliser par TOUTE route qui renvoie un coût,
 * EN PLUS du contrôle d'accès à la fonction (canViewFeature) — jamais à sa place : ce droit n'ouvre aucun écran.
 */
export async function canViewCost(supabase: any, role: string | null | undefined, shop_id: string): Promise<boolean> {
  if (!role) return false
  if (role === 'owner' || role === 'super_admin') return true
  return canViewCostRule(await loadStored(supabase, shop_id), role)
}

/** @deprecated = canViewFeature ; conservé pour les routes de lecture existantes */
export const hasRolePermission = canViewFeature
