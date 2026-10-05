// Hiérarchie des rôles d'équipe — SOURCE UNIQUE, partagée par l'interface et
// les routes /api/team/* (refonte Boutiques / Équipe du 5 oct. 2026).
//
// Libellés affichés (messages/*.json → roles) :
//   owner = Propriétaire · shop_manager = « Manager » · manager = « Responsable »
//   cashier = Caissier · stock_manager = Gestionnaire de stock · viewer = Observateur
//
// Décisions de l'utilisateur :
//   - Propriétaire : tout le compte (boutiques, abonnement, permissions).
//   - Manager : plusieurs boutiques affectées, fonctions administratives
//     déléguées ; gère les Responsables et l'équipe opérationnelle ; ne
//     modifie jamais les permissions.
//   - Responsable : gestion opérationnelle de SES boutiques et de l'équipe
//     locale (caissiers, gestionnaires de stock, observateurs).
//   - Les droits fonctionnels (stock, caisse, ventes…) restent ceux de
//     shops.role_permissions (lib/hooks/use-role-permissions.ts et
//     lib/api/role-permissions.ts) : aucun second système.

import type { UserRole } from '@/lib/types/database'

/** Rôles qui donnent accès à la gestion d'équipe et à l'onglet Boutiques */
export const TEAM_MANAGER_ROLES: UserRole[] = ['super_admin', 'owner', 'shop_manager', 'manager']

/** Rôles qu'un membre peut recevoir (jamais « owner » ni « super_admin » par l'équipe) */
export const ASSIGNABLE_ROLES: UserRole[] = ['shop_manager', 'manager', 'cashier', 'stock_manager', 'viewer']

/** Ordre d'affichage (fiche boutique → Équipe, listes) */
export const ROLE_ORDER: UserRole[] = ['owner', 'shop_manager', 'manager', 'cashier', 'stock_manager', 'viewer']

/** Rôles qu'un appelant peut attribuer, modifier ou retirer dans une boutique */
export function manageableRoles(callerRole: string | null | undefined): UserRole[] {
  switch (callerRole) {
    case 'super_admin':
    case 'owner':
      return ASSIGNABLE_ROLES
    case 'shop_manager':
      return ['manager', 'cashier', 'stock_manager', 'viewer']
    case 'manager':
      return ['cashier', 'stock_manager', 'viewer']
    default:
      return []
  }
}

/** L'appelant peut-il gérer (rôle, retrait) un membre qui a ce rôle ? */
export function canManageRole(callerRole: string | null | undefined, targetRole: string | null | undefined): boolean {
  return !!targetRole && manageableRoles(callerRole).includes(targetRole as UserRole)
}

export function isTeamManager(role: string | null | undefined): boolean {
  return !!role && TEAM_MANAGER_ROLES.includes(role as UserRole)
}

/** Propriétaire du compte (ou administrateur plateforme) : abonnement, permissions, compte des membres */
export function isAccountOwner(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'super_admin'
}
