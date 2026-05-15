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
      <div
        className="md:hidden fixed top-0 left-0 right-0 z-30 h-14 flex items-center px-4 gap-3 border-b border-blue-900/40"
        style={{ background: 'linear-gradient(135deg, #073e8a 0%, #0d52b8 100%)' }}
      >
        <img src="/logo-icon-t.png" alt="StockShop" className="h-8 w-8 object-contain brightness-0 invert flex-shrink-0" />
        <div className="flex flex-col leading-none">
          <span className="font-bold text-sm text-white tracking-wide">StockShop</span>
          <span className="text-[9px] font-semibold text-stockshop-gold tracking-widest uppercase">Admin Panel</span>
        </div>
        {/* Live dot */}
        <div className="ml-auto flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
          </span>
          <span className="text-[9px] text-green-400 font-semibold tracking-wide">LIVE</span>
        </div>
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
