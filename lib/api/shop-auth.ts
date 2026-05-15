import { createClient } from '@/lib/supabase/server'

const SUPER_ADMIN_EMAILS = (process.env.SUPER_ADMIN_EMAILS || process.env.NEXT_PUBLIC_SUPER_ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean)

/** Vérifie si l'utilisateur est super_admin — via email allowlist OU rôle DB */
export function isSuperAdminUser(email: string | undefined | null, dbRole?: string | null): boolean {
  if (email && SUPER_ADMIN_EMAILS.includes(email)) return true
  if (dbRole === 'super_admin') return true
  return false
}

export async function getAuthedUser() {
  const supabase = await createClient() as any
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
