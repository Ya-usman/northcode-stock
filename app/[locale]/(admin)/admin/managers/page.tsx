import { createAdminClient } from '@/lib/supabase/server'
import { ManagersView } from '@/components/admin/managers-view'

export default async function AdminManagersPage() {
  const supabase = createAdminClient()

  const [{ data: shops }, { data: members }] = await Promise.all([
    supabase.from('shops').select('id, name, city, country').order('name'),
    (supabase as any)
      .from('shop_members')
      .select('id, shop_id, user_id, role, is_active, profiles(full_name, id)')
      .in('role', ['owner', 'manager'])
      .eq('is_active', true),
  ])

  // Enrich with email via admin API (server-side only)
  const managers = await Promise.all(
    (members || []).map(async (m: any) => {
      try {
        const { data } = await supabase.auth.admin.getUserById(m.user_id)
        return { ...m, email: data.user?.email ?? null }
      } catch {
        return { ...m, email: null }
      }
    })
  )

  return <ManagersView shops={shops ?? []} managers={managers} />
}
