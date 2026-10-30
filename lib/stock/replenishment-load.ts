import { fetchAllRows } from '@/lib/dashboard/fetch-rows'
import { availableQty, fetchExpiredQtyByProduct, fetchSoldQty30d, lowStockThresholdOf } from '@/lib/stock/signals'
import { fetchReservedQtyByProduct } from '@/lib/stock/reservations'
import { loadStockPipeline } from '@/lib/stock/pipeline-load'
import { shopToday } from '@/lib/stock/sellable'
import { leadTimeOf, observedLeadDays, replenishNeed, type ReplenishReason } from '@/lib/stock/replenishment'

// Lecture serveur (rôle de service) de tout ce qu'il faut pour proposer un réapprovisionnement : quantités du Stock
// (disponible = physique − périmé − réservé), ventes 30 jours, stock à venir (bons envoyés, transferts en route),
// brouillons de bons de commande, fournisseurs (délai déclaré 189 ou constaté), prix par fournisseur.
// Les droits sont décidés par l'appelant (/api/stock/replenishment) ; ici, seulement les boutiques autorisées.

export interface ReplenishShopScope {
  id: string
  canOrder: boolean
  canViewCost: boolean
  /** La personne voit les Fournisseurs : chiffres « en commande » et « en brouillon » montrés */
  seesOrders: boolean
  /** La personne voit les Transferts : chiffre « en transit » montré */
  seesTransfers: boolean
}

export interface ReplenishItem {
  product_id: string
  shop_id: string
  name: string
  sku: string | null
  unit: string | null
  image_url: string | null
  supplier_id: string | null
  physical: number
  available: number
  on_order: number | null
  in_transit: number | null
  drafted: number | null
  threshold: number
  sold30: number | null
  reason: ReplenishReason | null
  projected: number
  daily: number | null
  coverage_days: number | null
  requested?: boolean
  offers: { supplier_id: string; price: number | null; price_at: string | null }[]
}

export interface ReplenishSupplier { id: string; shop_id: string; name: string; phone: string | null; lead_days: number | null; lead_source: 'declared' | 'observed' | null; declared_days: number | null }

const REASON_ORDER: Record<string, number> = { out: 0, low: 1, coverage: 2 }

export async function loadReplenishment(admin: any, scopes: ReplenishShopScope[], opts: { include?: string | null } = {}) {
  const shopIds = scopes.map(s => s.id)
  const scopeOf = Object.fromEntries(scopes.map(s => [s.id, s]))

  // Fournisseurs : avec le délai déclaré si la colonne existe (189), sinon sans (avant la 189)
  let leadTimeSupported = true
  let suppliersRaw: any[] = []
  {
    const withLead = await admin.from('suppliers').select('id, shop_id, name, phone, lead_time_days').in('shop_id', shopIds).is('deleted_at', null).order('name')
    if (withLead.error) {
      leadTimeSupported = false
      const plain = await admin.from('suppliers').select('id, shop_id, name, phone').in('shop_id', shopIds).is('deleted_at', null).order('name')
      if (plain.error) throw plain.error
      suppliersRaw = plain.data || []
    } else suppliersRaw = withLead.data || []
  }

  const [shops, products, expired, reserved, sold, pipeline, drafts, received, prices] = await Promise.all([
    admin.from('shops').select('id, name, currency, low_stock_threshold, timezone, country').in('id', shopIds).then((r: any) => { if (r.error) throw r.error; return r.data || [] }),
    fetchAllRows<any>(() => admin.from('products')
      .select('id, shop_id, name, sku, unit, image_url, quantity, low_stock_threshold, supplier_id')
      .in('shop_id', shopIds).eq('is_active', true).order('id', { ascending: true })),
    fetchExpiredQtyByProduct(admin, shopIds),
    fetchReservedQtyByProduct(admin, shopIds),
    fetchSoldQty30d(admin, shopIds).then(m => m as Record<string, number>).catch(() => null),
    loadStockPipeline(admin, { stockShops: shopIds, transferShops: shopIds, orderShops: shopIds }),
    fetchAllRows<any>(() => admin.from('purchase_orders')
      .select('id, shop_id, purchase_order_items(product_id, quantity_ordered)')
      .in('shop_id', shopIds).eq('status', 'draft').order('id', { ascending: true })),
    fetchAllRows<any>(() => admin.from('purchase_orders')
      .select('id, supplier_id, sent_at, received_at')
      .in('shop_id', shopIds).in('status', ['received', 'partial']).not('sent_at', 'is', null).not('received_at', 'is', null)
      .order('id', { ascending: true })),
    fetchAllRows<any>(() => admin.from('product_supplier_prices')
      .select('product_id, supplier_id, price, updated_at')
      .in('shop_id', shopIds).order('id', { ascending: true })),
  ])

  const shopById = Object.fromEntries(shops.map((s: any) => [s.id, s]))
  const draftedBy: Record<string, number> = {}
  for (const po of drafts) for (const it of po.purchase_order_items || []) {
    if (it.product_id) draftedBy[it.product_id] = (draftedBy[it.product_id] || 0) + (Number(it.quantity_ordered) || 0)
  }
  const observed = observedLeadDays(received)
  const suppliers: ReplenishSupplier[] = suppliersRaw.map((s: any) => {
    const lt = leadTimeOf(leadTimeSupported ? s.lead_time_days : null, observed[s.id])
    return { id: s.id, shop_id: s.shop_id, name: s.name, phone: s.phone ?? null, lead_days: lt?.days ?? null, lead_source: lt?.source ?? null, declared_days: leadTimeSupported ? (s.lead_time_days ?? null) : null }
  })
  const supplierById = Object.fromEntries(suppliers.map(s => [s.id, s]))
  const offersBy: Record<string, { supplier_id: string; price: number; price_at: string | null }[]> = {}
  for (const p of prices) {
    if (!supplierById[p.supplier_id]) continue // fournisseur supprimé ou d'une autre boutique
    ;(offersBy[p.product_id] ||= []).push({ supplier_id: p.supplier_id, price: Number(p.price), price_at: p.updated_at ?? null })
  }

  const items: ReplenishItem[] = []
  for (const p of products) {
    const sc = scopeOf[p.shop_id]
    if (!sc) continue
    const physical = Number(p.quantity) || 0
    const available = availableQty(physical, expired[p.id], reserved[p.id])
    const pipe = pipeline.byProduct[p.id] || { onOrder: 0, inTransit: 0 }
    const facts = {
      available, onOrder: pipe.onOrder, inTransit: pipe.inTransit, drafted: draftedBy[p.id] || 0,
      threshold: lowStockThresholdOf(p, shopById[p.shop_id]?.low_stock_threshold), sold30: sold ? (sold[p.id] ?? 0) : null,
    }
    const usualLead = p.supplier_id ? supplierById[p.supplier_id]?.lead_days ?? null : null
    const need = replenishNeed(facts, usualLead)
    const requested = opts.include === p.id
    if (!need.needed && !requested) continue
    // Offres : le fournisseur habituel et ceux qui ont déjà un prix pour ce produit ; prix seulement avec le droit au coût
    const offerList = (offersBy[p.id] || []).map(o => ({ supplier_id: o.supplier_id, price: sc.canViewCost ? o.price : null, price_at: sc.canViewCost ? o.price_at : null }))
    if (p.supplier_id && supplierById[p.supplier_id] && !offerList.some(o => o.supplier_id === p.supplier_id)) offerList.push({ supplier_id: p.supplier_id, price: null, price_at: null })
    items.push({
      product_id: p.id, shop_id: p.shop_id, name: p.name, sku: p.sku ?? null, unit: p.unit ?? null, image_url: p.image_url ?? null,
      supplier_id: p.supplier_id && supplierById[p.supplier_id] ? p.supplier_id : null,
      physical, available,
      on_order: sc.seesOrders ? facts.onOrder : null,
      in_transit: sc.seesTransfers ? facts.inTransit : null,
      drafted: sc.seesOrders ? facts.drafted : null,
      threshold: facts.threshold, sold30: facts.sold30,
      reason: need.reason ?? null, projected: need.projected, daily: need.daily, coverage_days: need.coverageDays,
      ...(requested ? { requested: true } : {}),
      offers: offerList,
    })
  }
  items.sort((a, b) => (REASON_ORDER[a.reason ?? ''] ?? 3) - (REASON_ORDER[b.reason ?? ''] ?? 3) || a.name.localeCompare(b.name))

  return {
    lead_time_supported: leadTimeSupported,
    shops: scopes.map(sc => {
      const sh = shopById[sc.id] || {}
      return { id: sc.id, name: sh.name ?? '', currency: sh.currency ?? null, today: shopToday(sh), can_order: sc.canOrder, can_view_cost: sc.canViewCost }
    }),
    suppliers,
    items,
  }
}
