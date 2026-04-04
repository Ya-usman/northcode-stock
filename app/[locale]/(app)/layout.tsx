import { AppLayout } from '@/components/layout/app-layout'

// Auth is handled client-side in AppLayout via useAuth().
// The middleware already protects all routes in this group.
export default function AppRouteLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  return (
    <AppLayout locale={locale}>
      {children}
    </AppLayout>
  )
}
