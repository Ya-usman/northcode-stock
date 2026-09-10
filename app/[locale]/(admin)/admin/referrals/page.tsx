import { createClient } from '@/lib/supabase/server'
import { getAdminTier } from '@/lib/api/require-admin'
import { AdminPageHeader } from '@/components/admin/ui/admin-page-header'
import { ReferralPayoutsPanel } from '@/components/admin/referral-payouts-panel'

export const dynamic = 'force-dynamic'

// Admin > Parrainage — pour l'instant centré sur les demandes de retrait
// (phase 5). La phase 6 étoffera cette page : stats, recherche de code,
// filleuls, modération des récompenses.
export default async function AdminReferralsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const tier = (user ? await getAdminTier(user.id) : null) ?? 'support'

  return (
    <div className="space-y-4 max-w-5xl">
      <AdminPageHeader
        title="Parrainage"
        description="Programme de parrainage utilisateur — demandes de retrait"
      />
      <ReferralPayoutsPanel tier={tier} />
    </div>
  )
}
