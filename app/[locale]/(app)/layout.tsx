import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { AppLayout } from '@/components/layout/app-layout'
import { OfflinePreloader } from '@/components/offline/offline-preloader'
import { AppUpdateChecker } from '@/components/app-update/app-update-checker'
import { PhotoRestoreHandler } from '@/components/photo/photo-restore-handler'

// AuthProvider is mounted in app/layout.tsx (root layout) so it persists
// across locale changes and route groups — no skeleton when switching.
// OfflineBanner is rendered inside AppLayout to avoid mounting it twice.
//
// The root [locale]/layout.tsx now only provides a small public-page subset
// of translations (landing/auth/register) — the authenticated app needs the
// full catalog, so it gets its own provider here with everything.
export default async function AppRouteLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  const messages = await getMessages()

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <OfflinePreloader />
      <AppUpdateChecker />
      <PhotoRestoreHandler />
      <AppLayout locale={locale}>
        {children}
      </AppLayout>
    </NextIntlClientProvider>
  )
}
