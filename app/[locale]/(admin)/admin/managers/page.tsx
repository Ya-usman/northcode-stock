import { createAdminClient } from '@/lib/supabase/server'
import { ManagersView } from '@/components/admin/managers-view'

export const dynamic = 'force-dynamic'

export default async function AdminManagersPage() {
  const supabase = createAdminClient()

  // Fetch members first, then derive shops from them (avoids shops with no owner/manager appearing)
  const { data: rawMembers } = await (supabase as any)
    .from('shop_members')
    .select('id, shop_id, user_id, role, is_active, shops(id, name, city, country, deleted_at)')
    .in('role', ['owner', 'manager'])
    .eq('is_active', true)

  // Build unique shops list from members (only shops that have at least one owner/manager)
  const shopsMap: Record<string, any> = {}
  for (const m of rawMembers || []) {
    const s = m.shops
    if (s && !s.deleted_at && !shopsMap[s.id]) shopsMap[s.id] = s
  }
  const shops = Object.values(shopsMap).sort((a: any, b: any) => a.name.localeCompare(b.name))

  // Fetch profiles separately (no direct FK shop_members.user_id → profiles.id)
  const userIds = Array.from(new Set((rawMembers || []).map((m: any) => m.user_id)))
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
