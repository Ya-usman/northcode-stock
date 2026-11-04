export const dynamic = 'force-dynamic'

import { CustomQuotesAdmin } from '@/components/admin/custom-quotes-admin'

// Admin → Devis sur mesure (étape 3 de la tarification, migration 211) : tout administrateur en lecture ;
// /api/admin/custom-quotes revérifie l'accès (envoi, prolongation, refus : super_admin).
export default function AdminQuotesPage() {
  return <CustomQuotesAdmin />
}
