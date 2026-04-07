import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { LayoutDashboard, ShoppingBag, CreditCard, LogOut, Package, ArrowLeftRight, Users } from 'lucide-react'

const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim())

export default async function AdminLayout({
  children,
  params: { locale },
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || !SUPER_ADMIN_EMAILS.includes(user.email || '')) {
    redirect(`/${locale}/login`)
  }

  const navItems = [
    { href: `/${locale}/admin`, label: 'Dashboard', icon: LayoutDashboard },
    { href: `/${locale}/admin/shops`, label: 'Boutiques', icon: ShoppingBag },
    { href: `/${locale}/admin/stock`, label: 'Stock', icon: Package },
    { href: `/${locale}/admin/transfers`, label: 'Transferts', icon: ArrowLeftRight },
    { href: `/${locale}/admin/managers`, label: 'Responsables', icon: Users },
    { href: `/${locale}/admin/payments`, label: 'Paiements', icon: CreditCard },
  ]

  return (
    <div className="min-h-screen bg-gray-950 text-white flex">
      {/* Sidebar */}
      <aside className="hidden md:flex w-56 flex-col fixed inset-y-0 border-r border-gray-800 bg-gray-950 z-30">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-gray-800">
          <div className="h-8 w-8 rounded-lg bg-northcode-gold flex items-center justify-center text-gray-900 font-bold text-sm">
            NC
          </div>
          <div>
            <p className="font-bold text-white text-sm leading-none">NorthCode</p>
            <p className="text-[10px] text-northcode-gold font-semibold mt-0.5">OWNER PANEL</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-gray-800 p-4">
          <p className="text-xs text-gray-600 mb-3">{user.email}</p>
          <a
            href={`/${locale}/dashboard`}
            className="flex items-center gap-2 text-xs text-gray-400 hover:text-white transition-colors"
          >
            <LogOut className="h-3.5 w-3.5" />
            Back to App
          </a>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 border-b border-gray-800 bg-gray-950 h-14 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-northcode-gold flex items-center justify-center text-gray-900 font-bold text-xs">NC</div>
          <span className="font-bold text-sm text-northcode-gold">OWNER PANEL</span>
        </div>
        <div className="flex gap-3">
          {navItems.map(({ href, icon: Icon }) => (
            <Link key={href} href={href} className="text-gray-400 hover:text-white">
              <Icon className="h-5 w-5" />
            </Link>
          ))}
        </div>
      </div>

      {/* Main */}
      <main className="flex-1 md:pl-56 pt-14 md:pt-0">
        <div className="p-5 md:p-8">{children}</div>
      </main>
    </div>
  )
}
