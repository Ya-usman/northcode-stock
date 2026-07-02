import { AppLayout } from '@/components/layout/app-layout'
import { OfflinePreloader } from '@/components/offline/offline-preloader'
import { AppUpdateChecker } from '@/components/app-update/app-update-checker'

// AuthProvider is mounted in app/[locale]/layout.tsx so it persists
// across (admin) and (app) route groups — no skeleton when switching.
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
