import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function getAuthedUser() {
  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  )
  const { data: { user } } = await supabase.auth.getUser()
  return { user, supabase }
}

export async function checkShopRole(supabase: any, userId: string, shopId: string): Promise<string | null> {
  const [{ data: member }, { data: profile }, { data: shop }] = await Promise.all([
    supabase.from('shop_members').select('role').eq('shop_id', shopId).eq('user_id', userId).eq('is_active', true).single(),
    supabase.from('profiles').select('role, shop_id').eq('id', userId).single(),
    supabase.from('shops').select('owner_id').eq('id', shopId).single(),
  ])
  if (!profile) return null
  if (profile.role === 'super_admin') return 'super_admin'
  if (profile.role === 'owner') {
    if (member?.role) return member.role
    if (shop?.owner_id === userId) return 'owner'
    if (profile.shop_id === shopId) return 'owner'
    return null
  }
  // Non-owner: full role only in their primary shop; viewer elsewhere
  if (profile.shop_id === shopId) return member?.role ?? profile.role
  if (member?.role) return 'viewer'
  return null
}
