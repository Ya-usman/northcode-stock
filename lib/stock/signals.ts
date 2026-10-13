import { withTimeout } from '@/lib/utils/with-timeout'
import { getExpiryAlertDays } from '@/lib/utils/expiry'
import { getPageCache, setPageCache } from '@/lib/offline/page-cache'

// ── Cache local des signaux ────────────────────────────────────────────────
// Partagé entre la Vue d'ensemble et Produits : la page qui a chargé les
// signaux les laisse pour la suivante, qui s'affiche sans attendre (filtre
// « Stock dormant », colonne Ventes 30 j, badges de péremption), puis
// rafraîchit en arrière-plan. Une journée de validité : au-delà, on repart
// de zéro plutôt que d'afficher des ventes 30 j d'un autre mois.

export interface CachedSignals {
  expiryByProduct?: Record<string, string>
  soldQtyByProduct?: Record<string, number>
  /** Quantité des lots PÉRIMÉS encore en stock, par produit */
  expiredQtyByProduct?: Record<string, number>
  /** Quantité RÉSERVÉE par les factures en attente, par produit — lib/stock/reservations */
  reservedQtyByProduct?: Record<string, number>
  /** Stock à venir (en transit, en commande) — lib/stock/pipeline */
  pipeline?: import('./pipeline').StockPipeline
}

const SIGNALS_MAX_AGE_MS = 24 * 60 * 60 * 1000

export const signalsCacheKey = (shopIds: string[]) => `stock_signals_${shopIds.join(',')}`

export function readSignalsCache(shopIds: string[]): CachedSignals | null {
  if (typeof window === 'undefined' || !shopIds.length) return null
  return getPageCache<CachedSignals>(signalsCacheKey(shopIds), SIGNALS_MAX_AGE_MS)
}

/** Fusionne avec l'entrée existante : chaque signal peut arriver séparément. */
export function writeSignalsCache(shopIds: string[], partial: CachedSignals): void {
  if (!shopIds.length) return
  const current = readSignalsCache(shopIds) || {}
  setPageCache(signalsCacheKey(shopIds), { ...current, ...partial })
}

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

/** Jour courant de l'appareil, « AAAA-MM-JJ » (jamais via l'heure universelle : la date basculerait la veille au soir ou le lendemain matin). */
export function localToday(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Quantité encore en stock dans des lots PÉRIMÉS (date strictement avant aujourd'hui), par produit. */
export async function fetchExpiredQtyByProduct(supabase: Db, shopIds: string[], today: string = localToday()): Promise<Record<string, number>> {
  const { data, error } = await withTimeout<any>(supabase
    .from('product_batches')
    .select('product_id, quantity')
    .in('shop_id', shopIds)
    .gt('quantity', 0)
    .lt('expiry_date', today), 20_000)
  if (error) throw error
  const map: Record<string, number> = {}
  for (const b of (data || []) as { product_id: string; quantity: number }[]) map[b.product_id] = (map[b.product_id] || 0) + Number(b.quantity)
  return map
}

/**
 * Stock DISPONIBLE à la vente = physique − périmé − réservé (factures en
 * attente, lib/stock/reservations). Jamais négatif ; le périmé ne peut pas
 * dépasser le physique (un lot peut être en avance sur une correction de quantité).
 */
export function availableQty(physical: number, expired: number | null | undefined, reserved: number | null | undefined = 0): number {
  const p = Math.max(0, Number(physical) || 0)
  const e = Math.min(p, Math.max(0, Number(expired) || 0))
  return Math.max(0, p - e - Math.max(0, Number(reserved) || 0))
}

/**
 * Les quantités d'un produit, calculées à UN seul endroit (tableau, cartes,
 * fiche produit, serveur) :
 *   physique   = quantité en rayon ;
 *   périmé     = lots dont la date est dépassée (jamais plus que le physique) ;
 *   réservé    = factures en attente encore vivantes ;
 *   disponible = physique − périmé − réservé, jamais négatif.
 * En transit / en commande : null quand l'information n'est pas connue ou pas
 * visible pour ce rôle — jamais un zéro inventé.
 */
export interface StockQuantities {
  physical: number
  expired: number
  reserved: number
  available: number
  inTransit: number | null
  onOrder: number | null
}

export function stockQuantities(input: {
  physical: number
  expired?: number | null
  reserved?: number | null
  inTransit?: number | null
  onOrder?: number | null
}): StockQuantities {
  const physical = Math.max(0, Number(input.physical) || 0)
  const expired = Math.min(physical, Math.max(0, Number(input.expired) || 0))
  const reserved = Math.max(0, Number(input.reserved) || 0)
  const incoming = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.max(0, Number(v)))
  return {
    physical, expired, reserved,
    available: availableQty(physical, expired, reserved),
    inTransit: incoming(input.inTransit),
    onOrder: incoming(input.onOrder),
  }
}

/**
 * Couverture : combien de jours le stock VENDABLE (physique − périmé ; le
 * réservé sera vendu lui aussi) tient au rythme des ventes des 30 derniers
 * jours. Jamais de nombre absurde :
 *   unknown   ventes pas encore connues ;
 *   out       plus rien à vendre ;
 *   no_sales  aucune vente sur 30 jours → pas de prévision ;
 *   over_year plus de 365 jours → « plus d'un an », sans chiffre ;
 *   days      nombre de jours (0 = moins d'un jour) ; `lowVolume` quand moins
 *             de 3 unités vendues en 30 jours : estimation fragile.
 */
export type CoverageInfo =
  | { kind: 'unknown' }
  | { kind: 'out' }
  | { kind: 'no_sales' }
  | { kind: 'over_year' }
  | { kind: 'days'; days: number; lowVolume: boolean }

export const COVERAGE_LOW_VOLUME = 3
export const COVERAGE_MAX_DAYS = 365

export function coverageInfo(sellable: number, sold30d: number | null | undefined): CoverageInfo {
  if (sold30d === null || sold30d === undefined || !Number.isFinite(Number(sold30d))) return { kind: 'unknown' }
  const stock = Number(sellable)
  if (!Number.isFinite(stock) || stock <= 0) return { kind: 'out' }
  const sold = Number(sold30d)
  if (sold <= 0) return { kind: 'no_sales' }
  const days = Math.round(stock / (sold / 30))
  if (!Number.isFinite(days) || days > COVERAGE_MAX_DAYS) return { kind: 'over_year' }
  return { kind: 'days', days: Math.max(0, days), lowVolume: sold < COVERAGE_LOW_VOLUME }
}

/** Quantité vendue par produit sur les 30 derniers jours (ventes actives) ; `productId` limite la lecture à un produit. */
export async function fetchSoldQty30d(supabase: Db, shopIds: string[], productId?: string): Promise<Record<string, number>> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString()
  // Une seule lecture jointe, page par page. L'ancienne version lisait d'abord
  // les ventes puis passait TOUS leurs identifiants dans l'adresse de la
  // requête : au-delà de ~200 ventes sur 30 jours l'adresse devenait trop
  // longue (erreur 400) et la colonne restait vide ; la base plafonne aussi
  // chaque réponse à 1000 lignes.
  const PAGE = 1000
  const map: Record<string, number> = {}
  for (let from = 0; from < 100 * PAGE; from += PAGE) {
    let query = supabase
      .from('sale_items')
      .select('id, product_id, quantity, sales!inner(shop_id, sale_status, created_at)')
      .in('sales.shop_id', shopIds)
      .eq('sales.sale_status', 'active')
      .gte('sales.created_at', thirtyDaysAgo)
    if (productId) query = query.eq('product_id', productId)
    const { data: items, error } = await withTimeout<any>(query
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1), 20_000)
    if (error) throw error
    for (const it of (items || []) as { product_id: string | null; quantity: number }[]) {
      if (!it.product_id) continue
      map[it.product_id] = (map[it.product_id] || 0) + Number(it.quantity)
    }
    if (!items || items.length < PAGE) break
  }
  return map
}

/**
 * Ventes 30 j pour la liste du Stock, lues par le serveur (/api/stock/sold-30d).
 * Dans le navigateur, la base ne montre à un caissier que SES ventes : la
 * colonne valait 0 partout et tous les produits passaient en « Ventes lentes ».
 */
export async function fetchSoldQty30dForShops(shopIds: string[]): Promise<Record<string, number>> {
  const res = await withTimeout(fetch(`/api/stock/sold-30d?shop_ids=${shopIds.join(',')}`), 20_000)
  if (!res.ok) throw new Error(`sold-30d ${res.status}`)
  return (await res.json()).byProduct || {}
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
  /** Quantité des lots périmés par produit (absent = aucun) : elle sort du disponible */
  expiredQtyByProduct?: Record<string, number>
  /** Quantité réservée par produit (absent = aucune) : elle sort aussi du disponible */
  reservedQtyByProduct?: Record<string, number>
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

export type StockLevel = 'out' | 'low' | 'ok'

/**
 * Niveau de stock d'un produit, jugé sur le DISPONIBLE (physique − périmé −
 * réservé) : un produit dont tout le stock est périmé ou réservé est en
 * rupture, même s'il reste en rayon. Règle unique du module Stock (statut,
 * filtres, chiffres clés, export).
 */
export function stockLevelOf(
  p: { id: string; quantity: number; low_stock_threshold: number | null },
  ctx: { shopLowStockThreshold?: number | null; expiredQtyByProduct?: Record<string, number>; reservedQtyByProduct?: Record<string, number> },
): StockLevel {
  const available = availableQty(p.quantity, ctx.expiredQtyByProduct?.[p.id], ctx.reservedQtyByProduct?.[p.id])
  if (available === 0) return 'out'
  return available <= lowStockThresholdOf(p, ctx.shopLowStockThreshold) ? 'low' : 'ok'
}

export function computeStockKpis(products: StockProductLike[], ctx: StockRulesContext): StockKpis {
  const kpis: StockKpis = { total: products.length, out: 0, low: 0, expiring: 0, dormant: 0, dormantValue: 0, promo: 0, promoStale: 0, stockValue: 0, retailValue: 0 }
  for (const p of products) {
    const cost = Number(p.quantity) * Number(p.buying_price || 0)
    const level = stockLevelOf(p, ctx)
    if (level === 'out') kpis.out++
    else if (level === 'low') kpis.low++
    if (isExpired(p, ctx) || isExpiringSoon(p, ctx)) kpis.expiring++
    if (isDormant(p, ctx)) { kpis.dormant++; kpis.dormantValue += cost }
    if (isPromoActive(p)) kpis.promo++
    if (isPromoStale(p, ctx)) kpis.promoStale++
    kpis.stockValue += cost
    kpis.retailValue += Number(p.quantity) * Number(p.selling_price || 0)
  }
  return kpis
}
