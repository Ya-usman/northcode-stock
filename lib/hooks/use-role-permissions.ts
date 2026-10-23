// Côté interface de la règle unique de permissions (lib/permissions).
// `canAccess` = voir la page ; `canWrite` = créer / modifier / supprimer.
import { useAuthContext } from '@/lib/contexts/auth-context'
import {
  resolvePermission, mergeRolePerms, canViewCost as canViewCostRule, CONFIGURABLE_ROLES,
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

  // Prix d'achat, marges, valeur du stock : règle unique (lib/permissions → canViewCost). L'écran s'en sert pour
  // ne pas DEMANDER ces données ; c'est le serveur qui décide de les envoyer ou non.
  const canViewCost = canViewCostRule(stored, role)

  return { canAccess, canWrite, canViewCost, permissions }
}

/**
 * Droits évalués dans UNE boutique donnée (rôle de la personne dans cette boutique + réglages de cette
 * boutique), indépendamment de la boutique active interne. Sert en « Toutes les boutiques » : une
 * création ne propose que les boutiques où le droit existe ; une action suit la boutique de l'objet.
 * Boutique inconnue ou sans rôle → aucun droit (jamais le repli « propriétaire » de resolvePermission).
 */
export function useShopPermissions() {
  const { userShops, roleByShop } = useAuthContext()
  const resolveIn = (shopId: string | null | undefined, feature: PermFeature) => {
    const role = shopId ? roleByShop[shopId] : undefined
    const shop = shopId ? userShops.find(s => s.id === shopId) : undefined
    if (!role || !shop) return { view: false, write: false }
    return resolvePermission((shop as any).role_permissions as StoredPermissions | null | undefined, role, feature)
  }
  return {
    canAccessIn: (shopId: string | null | undefined, feature: PermFeature) => resolveIn(shopId, feature).view,
    canWriteIn: (shopId: string | null | undefined, feature: PermFeature) => resolveIn(shopId, feature).write,
    /** Prix d'achat, marges, montants des bons : règle unique canViewCost, dans CETTE boutique */
    canViewCostIn: (shopId: string | null | undefined) => {
      const role = shopId ? roleByShop[shopId] : undefined
      const shop = shopId ? userShops.find(s => s.id === shopId) : undefined
      if (!role || !shop) return false
      return canViewCostRule((shop as any).role_permissions as StoredPermissions | null | undefined, role)
    },
  }
}

/**
 * Navigation en « Toutes les boutiques » (règle D2, appliquée domaine par domaine) : pour une page DÉJÀ adoptée au
 * contexte boutique, l'entrée est visible si la personne a le droit de voir dans AU MOINS UNE boutique de l'en-tête
 * (la page fait ensuite choisir / filtrer la boutique, et chaque action est vérifiée sur la boutique réellement
 * utilisée). Pages pas encore adoptées : règle actuelle (boutique active), inchangée jusqu'à leur adoption.
 */
export const SCOPE_ADOPTED_FEATURES: PermFeature[] = ['new_sale', 'customers', 'categories', 'suppliers', 'expenses', 'notes', 'payments', 'sales_history']
export function useNavAccess() {
  const { canAccess } = useRolePermissions()
  const { canAccessIn } = useShopPermissions()
  const { effectiveShopIds } = useAuthContext()
  return (feature: PermFeature) => (SCOPE_ADOPTED_FEATURES.includes(feature)
    ? effectiveShopIds.some(id => canAccessIn(id, feature))
    : canAccess(feature))
}
