// Côté serveur de la règle unique de permissions (lib/permissions). Lit les
// réglages de la boutique (shops.role_permissions) et applique EXACTEMENT la
// même résolution que l'interface — plus aucune copie locale des défauts.
//
// Routes qui modifient des données → canWriteFeature ; routes de lecture →
// canViewFeature. Un Observateur n'obtient jamais « write ».

import { resolvePermission, isManagerial, type PermFeature, type StoredPermissions } from '@/lib/permissions'

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

/** @deprecated = canViewFeature ; conservé pour les routes de lecture existantes */
export const hasRolePermission = canViewFeature
