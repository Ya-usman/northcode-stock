import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ShopInspector } from '@/components/admin/shop-inspector'

const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)

export default async function ShopInspectorPage({
  params: { locale, shopId },
}: {
  params: { locale: string; shopId: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !SUPER_ADMIN_EMAILS.includes(user.email || '')) {
    redirect(`/${locale}/login`)
  }

  return <ShopInspector shopId={shopId} locale={locale} adminEmail={user.email!} />
}
