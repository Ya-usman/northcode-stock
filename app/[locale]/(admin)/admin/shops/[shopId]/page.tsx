import { createClient } from '@/lib/supabase/server'
import { ShopInspector } from '@/components/admin/shop-inspector'

// Autorisation déjà vérifiée par le layout parent (app/[locale]/(admin)/layout.tsx,
// table admin_users) — pas besoin de la revérifier ici, juste récupérer
// l'email pour l'affichage/l'attribution des actions de cette page.
export default async function ShopInspectorPage({
  params: { locale, shopId },
}: {
  params: { locale: string; shopId: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return <ShopInspector shopId={shopId} locale={locale} adminEmail={user?.email ?? ''} />
}
