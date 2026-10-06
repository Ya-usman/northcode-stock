export const dynamic = 'force-dynamic'

import { ActivationAdmin } from '@/components/admin/activation-admin'

// Admin → Activation (onboarding lot C2) : lecture seule, tout administrateur
// (la mise en page admin a déjà vérifié l'accès ; /api/admin/activation le revérifie).
export default function AdminActivationPage() {
  return <ActivationAdmin />
}
