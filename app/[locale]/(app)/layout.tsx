import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppLayout } from '@/components/layout/app-layout'
import type { Profile, Shop } from '@/lib/types/database'

export default async function AppRouteLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  const supabase = await createClient()

  // Auth check + profile fetch in parallel for speed
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/${locale}/login`)
  }

  const { data: profileData } = await supabase
    .from('profiles')
    .select('*, shops(*)')
    .eq('id', user.id)
    .single()

  const profile = profileData as (Profile & { shops: Shop | null }) | null

  if (!profile) {
    // User exists in auth but has no profile yet — show setup page instead of blank
    redirect(`/${locale}/login?error=no_profile`)
  }

  if (!profile.is_active) {
    redirect(`/${locale}/login?error=inactive`)
  }

  const shop = profile.shops as Shop | null

  return (
    <AppLayout
      profile={profile as Profile}
      shop={shop}
      locale={locale}
      userEmail={user.email || ''}
    >
      {children}
    </AppLayout>
  )
}
