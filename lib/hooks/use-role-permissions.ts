// Côté interface de la règle unique de permissions (lib/permissions).
// `canAccess` = voir la page ; `canWrite` = créer / modifier / supprimer.
import { useAuthContext } from '@/lib/contexts/auth-context'
import {
  resolvePermission, mergeRolePerms, canSeeCost as canSeeCostRule, CONFIGURABLE_ROLES,
  DEFAULT_PERMISSIONS, DEFAULT_GENERAL,
  type AllPerms, type ConfigurableRole, type PermFeature, type RolePerms, type StoredPermissions,
} from '@/lib/permissions'

export { DEFAULT_PERMISSIONS, DEFAULT_GENERAL }
export type { AllPerms, ConfigurableRole, PermFeature, RolePerms }

export function useRolePermissions() {
  const { shop, profile, roleInActiveShop } = useAuthContext()
  // Le rôle dans la boutique active (shop_members) fait foi ; profiles.role en repli
  const role = roleInActiveShop ?? profile?.role
  const stored = (shop as any)?.role_permissions as StoredPermissions | null | undefined

  const canAccess = (feature: PermFeature): boolean => resolvePermission(stored, role, feature).view
  const canWrite = (feature: PermFeature): boolean => resolvePermission(stored, role, feature).write

  // Réglages fusionnés (défauts + enregistrés) de chaque rôle configurable
  const permissions = Object.fromEntries(
    CONFIGURABLE_ROLES.map(r => [r, mergeRolePerms(r, stored)])
  ) as AllPerms

  // Prix d'achat, marges, valeur du stock : règle unique (lib/permissions → canSeeCost). L'écran s'en sert pour
  // ne pas DEMANDER ces données ; c'est le serveur qui décide de les envoyer ou non.
  const canSeeCost = canSeeCostRule(stored, role)

  return { canAccess, canWrite, canSeeCost, permissions }
}
