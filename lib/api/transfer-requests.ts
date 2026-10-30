import { canViewFeature, canWriteFeature } from '@/lib/api/role-permissions'
import { isManagerial } from '@/lib/permissions'
import { sendShopPush, sendUsersPush } from '@/lib/api/push-server'
import { shareStockWithSellers } from '@/lib/stock/elsewhere-load'

// Demandes de transfert entre boutiques (migration 190, conception du 30 oct. 2026) : règles communes aux routes.
// La boutique qui VEND demande (droit Caisse ou Transferts en modification) ; la boutique qui a le stock DÉCIDE
// (Transferts en modification). Toujours deux boutiques de la MÊME entreprise. Notifications : jamais bloquantes.

export const REQUEST_NOTE_MAX = 500

export async function memberRole(supabase: any, userId: string, shopId: string): Promise<string | null> {
  const { data } = await supabase.from('shop_members').select('role').eq('shop_id', shopId).eq('user_id', userId).eq('is_active', true).maybeSingle()
  return data?.role ?? null
}

/** Peut demander au nom de la boutique (vend, ou gère les transferts) ; réglage d'entreprise respecté pour les vendeurs */
export async function canRequestFor(supabase: any, admin: any, role: string | null, shopId: string): Promise<boolean> {
  if (!role) return false
  const allowed = (await canWriteFeature(supabase, role, shopId, 'new_sale')) || (await canWriteFeature(supabase, role, shopId, 'transfers'))
  if (!allowed) return false
  if (role === 'owner' || role === 'super_admin' || isManagerial(role)) return true
  const { data: shop } = await admin.from('shops').select('entity_id').eq('id', shopId).maybeSingle()
  return shareStockWithSellers(admin, shop?.entity_id ?? null)
}

/** Peut décider (accepter / refuser) pour la boutique qui a le stock */
export const canDecideFor = (supabase: any, role: string | null, shopId: string) =>
  role ? canWriteFeature(supabase, role, shopId, 'transfers') : Promise.resolve(false)

/** Voit les demandes d'une boutique (reçues : Transferts ; envoyées : Caisse ou Transferts) */
export async function canSeeRequests(supabase: any, role: string | null, shopId: string): Promise<{ incoming: boolean; outgoing: boolean }> {
  if (!role) return { incoming: false, outgoing: false }
  const [tr, pos] = await Promise.all([canViewFeature(supabase, role, shopId, 'transfers'), canViewFeature(supabase, role, shopId, 'new_sale')])
  return { incoming: tr, outgoing: tr || pos }
}

export async function sameEntity(admin: any, a: string, b: string): Promise<boolean> {
  const { data } = await admin.from('shops').select('id, entity_id, deleted_at').in('id', [a, b])
  const rows = (data || []) as any[]
  return rows.length === 2 && rows.every(r => !r.deleted_at && r.entity_id) && rows[0].entity_id === rows[1].entity_id
}

/** Notification aux personnes qui gèrent les transferts de la boutique qui a le stock */
export function notifyNewRequest(admin: any, sourceShopId: string, payload: { title: string; body: string }) {
  return sendShopPush(admin, sourceShopId, { ...payload, tag: 'transfer-request', url: '/stock/transfers' }, 'transfers').catch(() => 0)
}

/** Notification à la personne qui a fait la demande */
export function notifyRequester(admin: any, requestingShopId: string, requestedBy: string | null, payload: { title: string; body: string }) {
  if (!requestedBy) return Promise.resolve(0)
  return sendUsersPush(admin, requestingShopId, [requestedBy], { ...payload, tag: 'transfer-request', url: '/stock/transfers' }).catch(() => 0)
}
