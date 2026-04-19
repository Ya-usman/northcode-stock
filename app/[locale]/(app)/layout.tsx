import { AppLayout } from '@/components/layout/app-layout'
import { AuthProvider } from '@/lib/contexts/auth-context'
import { OfflineBanner } from '@/components/offline/offline-banner'

// AuthProvider wraps the entire app group — single subscription for all pages.
export default function AppRouteLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  return (
    <AuthProvider>
      <OfflineBanner />
      <AppLayout locale={locale}>
        {children}
      </AppLayout>
    </AuthProvider>
  )
}
