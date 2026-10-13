// Côté serveur de la règle unique de permissions (lib/permissions). Lit les
// réglages de la boutique (shops.role_permissions) et applique EXACTEMENT la
// même résolution que l'interface — plus aucune copie locale des défauts.
//
// Routes qui modifient des données → canWriteFeature ; routes de lecture →
// canViewFeature. Un Observateur n'obtient jamais « write ».

import { resolvePermission, isManagerial, canViewCost as canViewCostRule, type PermFeature, type StoredPermissions } from '@/lib/permissions'

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

export async function canWriteFeature(supabase: any, role: string | null | undefined, shop_id: string, feature: PermFeature): Promise<boolean> {
  if (!role) return false
  if (role === 'owner' || role === 'super_admin') return true
  return resolvePermission(await loadStored(supabase, shop_id), role, feature).write
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
