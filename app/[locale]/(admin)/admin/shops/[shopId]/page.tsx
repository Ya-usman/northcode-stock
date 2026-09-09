import { createClient } from '@/lib/supabase/server'
import { getAdminTier } from '@/lib/api/require-admin'
import { ShopInspector } from '@/components/admin/shop-inspector'

// Autorisation déjà vérifiée par le layout parent (app/[locale]/(admin)/layout.tsx,
// table admin_users) — pas besoin de la revérifier ici, juste récupérer
// l'email + le niveau d'accès pour l'affichage/la visibilité des actions.
export default async function ShopInspectorPage({
  params: { locale, shopId },
}: {
  params: { locale: string; shopId: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const tier = user ? await getAdminTier(user.id) : null

  return <ShopInspector shopId={shopId} locale={locale} adminEmail={user?.email ?? ''} tier={tier ?? 'support'} />
}
