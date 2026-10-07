'use client'

// Tours guidés que la personne peut réellement suivre, d'après son rôle et ses
// droits dans la boutique en cours : on ne propose pas « Inviter un membre » à
// un caissier, ni « Ajouter un produit » à qui ne peut pas modifier le stock.

import { useAuthContext } from '@/lib/contexts/auth-context'
import { useRolePermissions } from '@/lib/hooks/use-role-permissions'
import { isAccountOwner, isTeamManager } from '@/lib/team/roles'
import { TOUR_IDS, type TourId } from '@/lib/onboarding/tours'

export function useAvailableTours(): TourId[] {
  const { profile, roleInActiveShop } = useAuthContext()
  const { canAccess, canWrite } = useRolePermissions()
  const role = roleInActiveShop ?? profile?.role
  const allowed: Record<TourId, boolean> = {
    quick_tour: true,
    add_product: canWrite('stock'),
    first_sale: canAccess('new_sale'),
    add_category: canWrite('categories'),
    invite_member: isTeamManager(role),
    customize_receipt: isAccountOwner(role),
    opening_balance: canWrite('payments'),
    import_customers: canWrite('customers'),
    import_products: canWrite('stock'),
  }
  return TOUR_IDS.filter(id => allowed[id])
}
