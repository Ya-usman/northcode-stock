// Calcul des alertes de stock d'une boutique — RÈGLE UNIQUE partagée par les
// notifications push (cron low-stock-alert / expiry-alert) et l'e-mail
// quotidien groupé par propriétaire (cron owner-alerts). Serveur : client admin.

import { getExpiryAlertDays } from '@/lib/utils/expiry'

export interface LowStockItem { id: string; name: string; name_hausa: string | null; quantity: number; unit: string | null; threshold: number }
export interface ExpiryItem { product_id: string; name: string; name_hausa: string | null; unit: string | null; quantity: number; expiry_date: string }

/** Produits actifs sous leur seuil (seuil produit, sinon celui de la boutique, sinon 10) */
export async function getLowStockAlerts(admin: any, shop: { id: string; low_stock_threshold?: number | null }) {
  const threshold = shop.low_stock_threshold ?? 10
  const { data } = await admin
    .from('products')
    .select('id, name, name_hausa, quantity, unit, low_stock_threshold')
    .eq('shop_id', shop.id).eq('is_active', true).lte('quantity', threshold)
  const items: LowStockItem[] = (data ?? [])
    .filter((p: any) => p.quantity <= (p.low_stock_threshold ?? threshold))
    .map((p: any) => ({ id: p.id, name: p.name, name_hausa: p.name_hausa ?? null, quantity: Number(p.quantity), unit: p.unit ?? null, threshold: p.low_stock_threshold ?? threshold }))
  return { outOfStock: items.filter(p => p.quantity <= 0), lowStock: items.filter(p => p.quantity > 0), threshold }
}

/**
 * Lots périmés ou dans la fenêtre d'alerte (seuil de la catégorie, sinon de la
 * boutique, sinon 14 j), regroupés par produit : date la plus proche, quantités cumulées.
 */
export async function getExpiryAlerts(admin: any, shop: { id: string; expiry_alert_days?: number | null }, today = new Date()) {
  const shopAlertDays = shop.expiry_alert_days ?? 14
  const todayStr = today.toISOString().slice(0, 10)
  const { data: batches } = await admin
    .from('product_batches')
    .select('product_id, quantity, expiry_date, products(name, name_hausa, unit, categories(expiry_alert_days))')
    .eq('shop_id', shop.id).gt('quantity', 0).not('expiry_date', 'is', null)
  const grouped: Record<string, ExpiryItem> = {}
  for (const b of batches ?? []) {
    const alertDays = getExpiryAlertDays(b.products?.categories?.expiry_alert_days, shopAlertDays)
    const cutoffStr = new Date(today.getTime() + alertDays * 86_400_000).toISOString().slice(0, 10)
    if (b.expiry_date > cutoffStr) continue
    const p = b.products
    const existing = grouped[b.product_id]
    if (!existing || b.expiry_date < existing.expiry_date) {
      grouped[b.product_id] = {
        product_id: b.product_id, name: p?.name ?? '—', name_hausa: p?.name_hausa ?? null, unit: p?.unit ?? null,
        quantity: (existing?.quantity ?? 0) + Number(b.quantity), expiry_date: b.expiry_date,
      }
    } else existing.quantity += Number(b.quantity)
  }
  const items = Object.values(grouped)
  return {
    expired: items.filter(a => a.expiry_date < todayStr).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date)),
    expiringSoon: items.filter(a => a.expiry_date >= todayStr).sort((a, b) => a.expiry_date.localeCompare(b.expiry_date)),
  }
}
