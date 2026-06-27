import { AppLayout } from '@/components/layout/app-layout'
import { OfflineBanner } from '@/components/offline/offline-banner'
import { OfflinePreloader } from '@/components/offline/offline-preloader'
import { AppUpdateChecker } from '@/components/app-update/app-update-checker'

// AuthProvider is mounted in app/[locale]/layout.tsx so it persists
// across (admin) and (app) route groups — no skeleton when switching.
export default function AppRouteLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  return (
    <>
      <OfflineBanner />
      <OfflinePreloader />
      <AppUpdateChecker />
      <AppLayout locale={locale}>
        {children}
      </AppLayout>
    </>
  )
}
