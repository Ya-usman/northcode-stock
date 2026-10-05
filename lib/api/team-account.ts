// Outils serveur partagés par les routes /api/team/* (refonte Boutiques /
// Équipe du 5 oct. 2026). Toujours appelés avec un client admin (service role).

import { getAccountShopIds, type EntityAccount } from '@/lib/saas/team-quota'

/** Toutes les personnes (hors propriétaire) ayant ou ayant eu une affectation dans l'entreprise */
export async function listAccountPersonIds(admin: any, account: Pick<EntityAccount, 'entityId' | 'ownerId'>): Promise<string[]> {
  const ownerId = account.ownerId
  const shopIds = await getAccountShopIds(admin, account, { includeSuspended: true })
  if (!shopIds.length) return []
  const { data } = await admin.from('shop_members').select('user_id').in('shop_id', shopIds)
  return Array.from(new Set((data || []).map((r: any) => r.user_id as string).filter((id: string) => id !== ownerId)))
}

/**
 * Personne du compte qui possède cette adresse e-mail (comparaison sans casse).
 * Les e-mails ne sont pas copiés dans `profiles` : on lit auth.users pour les
 * seules personnes du compte (quelques dizaines au plus, formule Business = 30).
 */
export async function findAccountMemberByEmail(admin: any, account: Pick<EntityAccount, 'entityId' | 'ownerId'>, email: string): Promise<{ id: string; full_name: string | null } | null> {
  const target = email.trim().toLowerCase()
  const ids = await listAccountPersonIds(admin, account)
  const users = await Promise.all(ids.map(id => admin.auth.admin.getUserById(id).then((r: any) => r.data?.user).catch(() => null)))
  const hit = users.find((u: any) => u?.email?.toLowerCase() === target)
  if (!hit) return null
  const { data: profile } = await admin.from('profiles').select('full_name').eq('id', hit.id).maybeSingle()
  return { id: hit.id, full_name: profile?.full_name ?? null }
}

/**
 * Boutique principale (profiles.shop_id) toujours cohérente avec les
 * affectations actives : conservée si encore active, sinon remplacée par la
 * plus ancienne affectation active, ou vidée s'il n'en reste aucune.
 */
export async function syncPrimaryShop(admin: any, userId: string, preferShopId?: string): Promise<void> {
  const [{ data: profile }, { data: rows }] = await Promise.all([
    admin.from('profiles').select('shop_id, role').eq('id', userId).maybeSingle(),
    admin.from('shop_members').select('shop_id, created_at').eq('user_id', userId).eq('is_active', true).order('created_at', { ascending: true }),
  ])
  if (!profile || profile.role === 'owner' || profile.role === 'super_admin') return
  const active = (rows || []).map((r: any) => r.shop_id as string)
  if (profile.shop_id && active.includes(profile.shop_id)) return
  const next = (preferShopId && active.includes(preferShopId)) ? preferShopId : (active[0] ?? null)
  if (next !== profile.shop_id) await admin.from('profiles').update({ shop_id: next }).eq('id', userId)
}
