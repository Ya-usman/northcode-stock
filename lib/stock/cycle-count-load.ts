// Serveur seulement : candidats de l'inventaire tournant d'une boutique (lib/stock/cycle-count pour la règle).
// Le prix d'achat est lu ici pour CLASSER les produits ; il ne sort jamais de cette fonction.
import { fetchSoldQty30d } from '@/lib/stock/signals'
import { fetchAllRows } from '@/lib/dashboard/fetch-rows'
import { pickCycleProducts, type CycleCandidate } from '@/lib/stock/cycle-count'

export interface CycleSuggestion { id: string; name: string; unit: string | null; last_counted_at: string | null }

export async function suggestCycleProducts(admin: any, shopId: string, size: number): Promise<CycleSuggestion[]> {
  const [products, { data: counted }, sold] = await Promise.all([
    fetchAllRows<any>(() => admin.from('products').select('id, name, unit, quantity, buying_price')
      .eq('shop_id', shopId).eq('is_active', true).order('id', { ascending: true })),
    admin.rpc('product_last_counted', { p_shop_id: shopId }),
    fetchSoldQty30d(admin, [shopId]).catch(() => ({} as Record<string, number>)),
  ])
  const last: Record<string, string> = Object.fromEntries((counted || []).map((r: any) => [r.product_id, r.last_counted_at]))
  const unitOf: Record<string, string | null> = {}
  const candidates: CycleCandidate[] = products.map((p: any) => {
    unitOf[p.id] = p.unit ?? null
    const qty = Number(p.quantity) || 0
    return { id: p.id, name: p.name, quantity: qty, value: Math.max(0, qty) * (Number(p.buying_price) || 0), sold30: sold[p.id] || 0, lastCountedAt: last[p.id] ?? null }
  })
  return pickCycleProducts(candidates, size).map(c => ({ id: c.id, name: c.name, unit: unitOf[c.id], last_counted_at: c.lastCountedAt }))
}
