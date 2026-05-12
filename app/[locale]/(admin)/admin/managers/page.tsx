import { createAdminClient } from '@/lib/supabase/server'
import { ManagersView } from '@/components/admin/managers-view'

export const dynamic = 'force-dynamic'

export default async function AdminManagersPage() {
  const supabase = createAdminClient()

  const [{ data: shops }, { data: rawMembers }] = await Promise.all([
    (supabase as any).from('shops').select('id, name, city, country').is('deleted_at', null).order('name'),
    (supabase as any)
      .from('shop_members')
      .select('id, shop_id, user_id, role, is_active')
      .in('role', ['owner', 'manager'])
      .eq('is_active', true),
  ])

  // Fetch profiles separately (no direct FK shop_members.user_id → profiles.id)
  const userIds = [...new Set((rawMembers || []).map((m: any) => m.user_id))]
  const { data: profilesData } = userIds.length > 0
    ? await (supabase as any).from('profiles').select('id, full_name').in('id', userIds)
    : { data: [] as any[] }

  const profilesMap: Record<string, any> = {}
  ;(profilesData || []).forEach((p: any) => { profilesMap[p.id] = p })

  // Enrich with email via admin API (server-side only)
  const managers = await Promise.all(
    (rawMembers || []).map(async (m: any) => {
      try {
        const { data } = await supabase.auth.admin.getUserById(m.user_id)
        return { ...m, email: data.user?.email ?? null, profiles: profilesMap[m.user_id] ?? null }
      } catch {
        return { ...m, email: null, profiles: profilesMap[m.user_id] ?? null }
      }
    })
  )

  return <ManagersView shops={shops ?? []} managers={managers} />
}
