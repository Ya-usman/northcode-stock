import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

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
    redirect(`/${locale}/dashboard`)
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Admin nav */}
      <header className="border-b border-gray-800 px-6 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-7 w-7 rounded-md bg-northcode-gold flex items-center justify-center text-gray-900 font-bold text-xs">
            NC
          </div>
          <span className="font-bold text-sm text-white">NorthCode Admin</span>
          <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full font-semibold">SUPER ADMIN</span>
        </div>
        <a href={`/${locale}/dashboard`} className="text-xs text-gray-400 hover:text-white transition-colors">
          ← Back to App
        </a>
      </header>
      <main className="p-6">{children}</main>
    </div>
  )
}
