import { fetchAllRows } from '@/lib/dashboard/fetch-rows'
import { availableQty, fetchExpiredQtyByProduct } from '@/lib/stock/signals'
import { fetchReservedQtyByProduct } from '@/lib/stock/reservations'
import { isShopOpenNow } from '@/lib/saas/shop-hours'
import { buildProductIndex, matchIn, sortElsewhere, type ElsewhereShop } from '@/lib/stock/elsewhere'

// Lecture serveur (rôle de service) du stock des AUTRES boutiques de l'entreprise pour des produits d'une boutique
// (« Disponible ailleurs », 30 oct. 2026). Les droits sont décidés par l'appelant (/api/stock/elsewhere).
// Quantité affichée = DISPONIBLE (physique − périmé − réservé) ; jamais de prix ni de coût ; boutiques à 0 omises.

/** Réglage d'entreprise (migration 190) ; avant la 190 : activé (valeur par défaut) */
export async function shareStockWithSellers(admin: any, entityId: string | null): Promise<boolean> {
  if (!entityId) return true
  const { data, error } = await admin.from('entities').select('share_stock_with_sellers').eq('id', entityId).maybeSingle()
  if (error) return true
  return data?.share_stock_with_sellers !== false
}

/** Table des demandes présente (migration 190 appliquée) */
export async function transferRequestsAvailable(admin: any): Promise<boolean> {
  const { error } = await admin.from('stock_transfer_requests').select('id').limit(1)
  return !error
}

export async function loadElsewhere(admin: any, shopId: string, productIds: string[]) {
  const { data: shop } = await admin.from('shops').select('id, entity_id').eq('id', shopId).maybeSingle()
  if (!shop?.entity_id) return { shops: 0, items: {} as Record<string, { total: number; shops: ElsewhereShop[] }> }

  const { data: others } = await admin.from('shops')
    .select('id, name, city, phone, hours_enabled, opening_time, closing_time, hours_manual_override, hours_extension_until, timezone')
    .eq('entity_id', shop.entity_id).neq('id', shopId).is('deleted_at', null)
  const otherShops = (others || []) as any[]
  const items: Record<string, { total: number; shops: ElsewhereShop[] }> = {}
  if (!otherShops.length || !productIds.length) return { shops: otherShops.length, items }
  const otherIds = otherShops.map(s => s.id)

  const [{ data: mine }, theirs, expired, reserved, pendingRows] = await Promise.all([
    admin.from('products').select('id, shop_id, name, sku').eq('shop_id', shopId).in('id', productIds),
    fetchAllRows<any>(() => admin.from('products').select('id, shop_id, name, sku, quantity')
      .in('shop_id', otherIds).eq('is_active', true).order('id', { ascending: true })),
    fetchExpiredQtyByProduct(admin, otherIds),
    fetchReservedQtyByProduct(admin, otherIds),
    admin.from('stock_transfer_requests').select('source_shop_id, source_product_id, quantity')
      .eq('requesting_shop_id', shopId).eq('status', 'pending')
      .then((r: any) => (r.error ? [] : r.data || [])),
  ])
  const index = buildProductIndex(theirs)
  const byId = new Map<string, any>(theirs.map((p: any) => [p.id, p]))
  const pending = new Map<string, number>()
  for (const r of pendingRows as any[]) pending.set(`${r.source_shop_id}|${r.source_product_id}`, (pending.get(`${r.source_shop_id}|${r.source_product_id}`) || 0) + (Number(r.quantity) || 0))
  const now = new Date()

  for (const p of (mine || []) as any[]) {
    const shops: ElsewhereShop[] = []
    for (const s of otherShops) {
      const matchId = matchIn(index, s.id, p)
      if (!matchId) continue
      const other = byId.get(matchId)
      const available = availableQty(Number(other?.quantity) || 0, expired[matchId], reserved[matchId])
      if (available <= 0) continue
      const open = isShopOpenNow(s.hours_enabled, s.opening_time, s.closing_time, s.hours_manual_override, s.hours_extension_until, now, s.timezone)
      shops.push({
        shop_id: s.id, name: s.name, city: s.city ?? null, phone: s.phone ?? null,
        open, closes_at: s.hours_enabled && open ? String(s.closing_time || '').slice(0, 5) || null : null,
        source_product_id: matchId, available, pending: pending.get(`${s.id}|${matchId}`) || 0,
      })
    }
    if (shops.length) items[p.id] = { total: shops.reduce((t, x) => t + x.available, 0), shops: sortElsewhere(shops) }
  }
  return { shops: otherShops.length, items }
}
