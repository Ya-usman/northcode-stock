export const dynamic = 'force-dynamic'

import { createClient } from '@/lib/supabase/server'
import { getAdminTier } from '@/lib/api/require-admin'
import { AnnouncementsAdmin } from '@/components/admin/announcements-admin'

// Admin → Nouveautés : la mise en page admin a déjà vérifié l'accès ;
// seul un administrateur complet peut créer ou modifier (le serveur le revérifie).
export default async function AdminAnnouncementsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const tier = user ? await getAdminTier(user.id) : null
  return <AnnouncementsAdmin canEdit={tier === 'super_admin'} />
}
