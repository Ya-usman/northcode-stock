import Link from 'next/link'
import { Settings2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getAdminTier } from '@/lib/api/require-admin'
import { AdminPageHeader } from '@/components/admin/ui/admin-page-header'
import { ReferralAdminPanel } from '@/components/admin/referral-admin-panel'
import { ReferralPayoutsPanel } from '@/components/admin/referral-payouts-panel'

export const dynamic = 'force-dynamic'

// Admin > Parrainage — vue d'ensemble du programme de parrainage
// utilisateur : stats, recherche de code + modération, demandes de retrait.
export default async function AdminReferralsPage({ params: { locale } }: { params: { locale: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const tier = (user ? await getAdminTier(user.id) : null) ?? 'support'

  return (
    <div className="space-y-5 max-w-5xl">
      <AdminPageHeader
        title="Parrainage"
        description="Programme de parrainage utilisateur — stats, codes, récompenses, retraits"
        actions={
          <Link
            href={`/${locale}/admin/referrals/config`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
          >
            <Settings2 className="h-3.5 w-3.5" /> Configuration
          </Link>
        }
      />

      <ReferralAdminPanel tier={tier} locale={locale} />

      <div>
        <h2 className="text-sm font-semibold text-foreground mb-3">Demandes de retrait</h2>
        <ReferralPayoutsPanel tier={tier} />
      </div>
    </div>
  )
}
