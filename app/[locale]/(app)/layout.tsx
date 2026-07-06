import { AppLayout } from '@/components/layout/app-layout'
import { OfflinePreloader } from '@/components/offline/offline-preloader'
import { AppUpdateChecker } from '@/components/app-update/app-update-checker'

// AuthProvider is mounted in app/layout.tsx (root layout) so it persists
// across locale changes and route groups — no skeleton when switching.
// OfflineBanner is rendered inside AppLayout to avoid mounting it twice.
export default function AppRouteLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  return (
    <>
      <OfflinePreloader />
      <AppUpdateChecker />
      <AppLayout locale={locale}>
        {children}
      </AppLayout>
    </>
  )
}
