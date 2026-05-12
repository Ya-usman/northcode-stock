import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { headers } from 'next/headers'
import { LayoutDashboard, ShoppingBag, CreditCard, LogOut, Package, Users, TrendingUp } from 'lucide-react'

const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)

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

  const headersList = headers()
  const pathname = headersList.get('x-pathname') || ''

  const navItems = [
    { href: `/${locale}/admin`, label: 'Command Center', icon: LayoutDashboard },
    { href: `/${locale}/admin/analytics`, label: 'Analytics', icon: TrendingUp },
    { href: `/${locale}/admin/shops`, label: 'Boutiques', icon: ShoppingBag },
    { href: `/${locale}/admin/stock`, label: 'Stock', icon: Package },
    { href: `/${locale}/admin/managers`, label: 'Responsables', icon: Users },
    { href: `/${locale}/admin/payments`, label: 'Paiements', icon: CreditCard },
  ]

  return (
    <div className="min-h-screen bg-background text-foreground flex">
      {/* Sidebar */}
      <aside className="hidden md:flex w-56 flex-col fixed inset-y-0 border-r border-border bg-card z-30">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-border">
          <img src="/logo.png" alt="StockShop" className="h-14 w-auto dark:brightness-0 dark:invert" />
          <div>
            <p className="font-bold text-foreground text-sm leading-none">StockShop</p>
            <p className="text-[10px] text-stockshop-gold font-semibold mt-0.5">ADMIN PANEL</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || (href !== `/${locale}/admin` && pathname.startsWith(href))
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary/15 text-primary border border-primary/20'
                    : 'text-foreground/70 hover:text-foreground hover:bg-accent'
                }`}
              >
                <Icon className={`h-4 w-4 flex-shrink-0 ${isActive ? 'text-primary' : 'text-foreground/50'}`} />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="border-t border-border p-4 space-y-2.5">
          <p className="text-xs text-foreground/60 font-medium truncate">{user.email}</p>
          <a
            href={`/${locale}/dashboard`}
            className="flex items-center gap-2 text-xs text-foreground/60 hover:text-foreground transition-colors font-medium"
          >
            <LogOut className="h-3.5 w-3.5" />
            Back to App
          </a>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 border-b border-border bg-card h-14 flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-md bg-stockshop-gold flex items-center justify-center text-gray-900 font-bold text-xs">SS</div>
          <span className="font-bold text-sm text-stockshop-gold">ADMIN PANEL</span>
        </div>
        <div className="flex gap-3">
          {navItems.map(({ href, icon: Icon }) => (
            <Link key={href} href={href} className="text-foreground/60 hover:text-foreground">
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
