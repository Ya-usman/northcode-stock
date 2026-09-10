import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getAdminTier } from '@/lib/api/require-admin'
import { AdminPageHeader } from '@/components/admin/ui/admin-page-header'
import { ReferralConfigForm } from '@/components/admin/referral-config-form'

export const dynamic = 'force-dynamic'

// Admin > Parrainage > Configuration — édition de referral_program_config
// (la seule et unique source de vérité lue par le moteur de parrainage).
export default async function ReferralConfigPage({ params: { locale } }: { params: { locale: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const tier = (user ? await getAdminTier(user.id) : null) ?? 'support'

  return (
    <div className="space-y-5 max-w-3xl">
      <Link
        href={`/${locale}/admin/referrals`}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Parrainage
      </Link>

      <AdminPageHeader
        title="Configuration du parrainage"
        description="Paramètres appliqués en temps réel par le moteur de parrainage"
      />

      <ReferralConfigForm tier={tier} />
    </div>
  )
}
