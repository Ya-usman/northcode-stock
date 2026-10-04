import { withTimeout } from '@/lib/utils/with-timeout'
import { getExpiryAlertDays } from '@/lib/utils/expiry'

// Signaux de stock partagés entre la Vue d'ensemble et la page Produits :
// date de péremption la plus proche par produit (lots encore en stock) et
// quantité vendue sur 30 jours glissants (stock dormant). Deux appels
// séparés, chacun pouvant échouer sans l'autre : l'appelant garde alors son
// dernier état connu plutôt que d'écraser avec un faux « vide ».
// Un seul endroit pour ces règles : un produit « dormant », « proche de
// péremption » ou « en stock bas » se compte de la même façon partout.

type Db = { from: (table: string) => any }

/** Date de péremption la plus proche par produit, lots en stock uniquement. */
export async function fetchExpiryByProduct(supabase: Db, shopIds: string[]): Promise<Record<string, string>> {
  const { data, error } = await withTimeout<any>(supabase
    .from('product_batches')
    .select('product_id, expiry_date')
    .in('shop_id', shopIds)
    .gt('quantity', 0)
    .not('expiry_date', 'is', null), 20_000)
  if (error) throw error
  const map: Record<string, string> = {}
  for (const b of (data || []) as { product_id: string; expiry_date: string }[]) {
    if (!map[b.product_id] || b.expiry_date < map[b.product_id]) map[b.product_id] = b.expiry_date
  }
  return map
}

/** Quantité vendue par produit sur les 30 derniers jours (ventes actives). */
export async function fetchSoldQty30d(supabase: Db, shopIds: string[]): Promise<Record<string, number>> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const { data: recentSales, error: salesErr } = await withTimeout<any>(supabase
    .from('sales')
    .select('id')
    .in('shop_id', shopIds)
    .eq('sale_status', 'active')
    .gte('created_at', thirtyDaysAgo), 20_000)
  if (salesErr) throw salesErr
  const saleIds = ((recentSales || []) as { id: string }[]).map(s => s.id)
  const map: Record<string, number> = {}
  if (!saleIds.length) return map
  const { data: items, error: itemsErr } = await withTimeout<any>(supabase
    .from('sale_items')
    .select('product_id, quantity')
    .in('sale_id', saleIds), 20_000)
  if (itemsErr) throw itemsErr
  for (const it of (items || []) as { product_id: string | null; quantity: number }[]) {
    if (!it.product_id) continue
    map[it.product_id] = (map[it.product_id] || 0) + it.quantity
  }
  return map
}

// ── Règles de statut ───────────────────────────────────────────────────────

export interface StockProductLike {
  id: string
  quantity: number
  low_stock_threshold: number | null
  buying_price: number
  selling_price: number
  category_id: string | null
  promo_price: number | null
  promo_until: string | null
  promo_start?: string | null
  /** Raison d'une promo posée depuis une suggestion ('expiry' | 'dormant'), sinon null */
  promo_reason?: string | null
}

export interface StockRulesContext {
  /** Seuil de stock bas de la boutique (repli : 10) */
  shopLowStockThreshold?: number | null
  /** Délai d'alerte péremption de la boutique */
  shopExpiryAlertDays?: number | null
  /** Délais d'alerte par catégorie (id → jours) */
  categoryAlertDays?: Record<string, number | null | undefined>
  expiryByProduct: Record<string, string>
  soldQtyByProduct: Record<string, number>
  /** Tant que les ventes 30 j ne sont pas chargées, aucun produit n'est « dormant » */
  soldQtyLoaded: boolean
  /** AAAA-MM-JJ, par défaut aujourd'hui */
  today?: string
}

export const DEFAULT_LOW_STOCK_THRESHOLD = 10

export function lowStockThresholdOf(p: { low_stock_threshold: number | null }, shopThreshold?: number | null): number {
  return p.low_stock_threshold || shopThreshold || DEFAULT_LOW_STOCK_THRESHOLD
}

export function expiryCutoffFor(p: { category_id: string | null }, ctx: StockRulesContext): string {
  const alertDays = getExpiryAlertDays(ctx.categoryAlertDays?.[p.category_id || ''], ctx.shopExpiryAlertDays)
  return new Date(Date.now() + alertDays * 86_400_000).toISOString().slice(0, 10)
}

export function isExpired(p: { id: string }, ctx: StockRulesContext): boolean {
  const exp = ctx.expiryByProduct[p.id]
  return !!exp && exp < (ctx.today ?? new Date().toISOString().slice(0, 10))
}

export function isExpiringSoon(p: { id: string; category_id: string | null }, ctx: StockRulesContext): boolean {
  const exp = ctx.expiryByProduct[p.id]
  const today = ctx.today ?? new Date().toISOString().slice(0, 10)
  return !!exp && exp >= today && exp <= expiryCutoffFor(p, ctx)
}

export function isDormant(p: { id: string; quantity: number }, ctx: StockRulesContext): boolean {
  return ctx.soldQtyLoaded && p.quantity > 0 && !(ctx.soldQtyByProduct[p.id] > 0)
}

export function isPromoActive(o: { promo_price?: number | null; promo_until?: string | null; promo_start?: string | null }): boolean {
  const now = new Date().toISOString()
  return !!o.promo_price && !!o.promo_until && o.promo_until >= now && (!o.promo_start || o.promo_start <= now)
}

/**
 * Promo posée depuis une suggestion (péremption proche, vente lente) dont la
 * raison a disparu : à revoir. Jamais retirée automatiquement (migration 094).
 */
export function isPromoStale(p: StockProductLike, ctx: StockRulesContext): boolean {
  if (!isPromoActive(p) || !p.promo_reason) return false
  if (p.promo_reason === 'expiry') return !isExpiringSoon(p, ctx)
  if (p.promo_reason === 'dormant') return !isDormant(p, ctx)
  return false
}

export interface StockKpis {
  total: number
  out: number
  low: number
  expiring: number
  dormant: number
  /** Σ quantité × prix d'achat des produits dormants : valeur immobilisée */
  dormantValue: number
  promo: number
  promoStale: number
  /** Σ quantité × prix d'achat (coût moyen pondéré tenu à la réception), même formule que Rapports */
  stockValue: number
  /** Σ quantité × prix de vente */
  retailValue: number
}

export function computeStockKpis(products: StockProductLike[], ctx: StockRulesContext): StockKpis {
  const kpis: StockKpis = { total: products.length, out: 0, low: 0, expiring: 0, dormant: 0, dormantValue: 0, promo: 0, promoStale: 0, stockValue: 0, retailValue: 0 }
  for (const p of products) {
    const threshold = lowStockThresholdOf(p, ctx.shopLowStockThreshold)
    const cost = Number(p.quantity) * Number(p.buying_price || 0)
    if (p.quantity === 0) kpis.out++
    else if (p.quantity <= threshold) kpis.low++
    if (isExpired(p, ctx) || isExpiringSoon(p, ctx)) kpis.expiring++
    if (isDormant(p, ctx)) { kpis.dormant++; kpis.dormantValue += cost }
    if (isPromoActive(p)) kpis.promo++
    if (isPromoStale(p, ctx)) kpis.promoStale++
    kpis.stockValue += cost
    kpis.retailValue += Number(p.quantity) * Number(p.selling_price || 0)
  }
  return kpis
}
