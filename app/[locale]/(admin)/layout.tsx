import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AdminBottomNav } from '@/components/admin/admin-bottom-nav'
import { AdminSidebar } from '@/components/admin/admin-sidebar'

const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)

export default async function AdminLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  const supabase = await createClient()
  // getUser() makes a server-side round-trip to verify the JWT.
  // Fall back to getSession() (local cookie read) if it returns null —
  // this handles cases where the Supabase project is briefly unavailable.
  let { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    const { data: { session } } = await supabase.auth.getSession()
    user = session?.user ?? null
  }

  if (!user) {
    redirect(`/${locale}/login`)
  }

  if (!SUPER_ADMIN_EMAILS.includes(user.email || '')) {
    redirect(`/${locale}/dashboard`)
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      {/* Sidebar desktop */}
      <AdminSidebar locale={locale} userEmail={user!.email ?? ''} />

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 border-b border-border bg-card h-14 flex items-center px-4 gap-2">
        <div className="h-7 w-7 rounded-md bg-stockshop-gold flex items-center justify-center text-gray-900 font-bold text-xs flex-shrink-0">SS</div>
        <span className="font-bold text-sm text-stockshop-gold">ADMIN PANEL</span>
      </div>

      {/* Mobile bottom nav */}
      <AdminBottomNav locale={locale} />

      {/* Main */}
      <main className="flex-1 md:pl-56 pt-14 md:pt-0 pb-16 md:pb-0 overflow-x-hidden">
        <div className="p-5 md:p-8">{children}</div>
      </main>
    </div>
  )
}
