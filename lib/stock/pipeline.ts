// Stock « à venir » d'une boutique : ce qui est EN TRANSIT (transferts envoyés
// vers elle, pas encore reçus) et ce qui est COMMANDÉ (bons de commande envoyés
// au fournisseur, pas encore reçus). Aucune de ces quantités n'est dans le
// stock physique : elles l'augmenteront à la réception.
//
// Règles (étape 5A de la refonte Stock, 13 oct. 2026) :
// - Commandé = bons au statut « envoyé ». Un bon reçu partiellement est clos
//   (la réception n'accepte qu'un brouillon ou un bon envoyé) : son reliquat
//   n'est plus attendu, il ne compte pas.
// - En transit = transferts au statut « envoyé » dont la boutique est la
//   DESTINATION. Une ligne de transfert ne connaît son produit de destination
//   qu'à la réception ; avant, on la rattache au produit de la boutique de
//   destination qui porte le même code-barres / référence, sinon le même nom
//   (sans majuscules, accents ni espaces en trop). Sans correspondance, la
//   quantité compte dans les totaux mais reste « non rattachée ».

export interface PipelineProduct { id: string; shop_id: string; name: string; sku: string | null }
export interface PipelineTransfer {
  id: string
  destination_shop_id: string
  items: { source_product_id: string | null; destination_product_id: string | null; product_name: string; quantity_sent: number }[]
}
export interface PipelineOrder {
  id: string
  shop_id: string
  items: { product_id: string | null; quantity_ordered: number }[]
}

export interface ProductPipeline { inTransit: number; onOrder: number }
export interface StockPipeline {
  /** Par produit de la boutique : quantités attendues (absent = rien d'attendu) */
  byProduct: Record<string, ProductPipeline>
  totals: {
    inTransitUnits: number
    inTransitTransfers: number
    /** Unités en transit qu'aucun produit de la boutique de destination ne reprend encore */
    inTransitUnmatched: number
    onOrderUnits: number
    onOrderOrders: number
  }
  /** Ce que la personne a le droit de voir (absent = tout) ; une valeur non visible ne s'affiche pas, elle ne vaut pas zéro */
  visible?: { inTransit: boolean; onOrder: boolean }
}

export const EMPTY_PIPELINE: StockPipeline = {
  byProduct: {},
  totals: { inTransitUnits: 0, inTransitTransfers: 0, inTransitUnmatched: 0, onOrderUnits: 0, onOrderOrders: 0 },
}

const nameKey = (name: string | null | undefined) =>
  (name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const skuKey = (sku: string | null | undefined) => (sku || '').trim().toLowerCase()

/**
 * @param products  produits des boutiques concernées (destinations et commandes)
 * @param sourceSku code-barres / référence des produits d'ORIGINE des transferts, par identifiant
 */
export function computeStockPipeline(
  products: PipelineProduct[],
  transfers: PipelineTransfer[],
  orders: PipelineOrder[],
  sourceSku: Record<string, string | null> = {},
): StockPipeline {
  const byProduct: Record<string, ProductPipeline> = {}
  const slot = (id: string) => (byProduct[id] ||= { inTransit: 0, onOrder: 0 })
  const known = new Set(products.map(p => p.id))

  // Index par boutique : code-barres puis nom. Un code ou un nom porté par
  // PLUSIEURS produits de la même boutique est ambigu : on ne rattache pas.
  const bySku = new Map<string, string | null>()
  const byName = new Map<string, string | null>()
  const index = (map: Map<string, string | null>, key: string, id: string) => map.set(key, map.has(key) ? null : id)
  for (const p of products) {
    if (skuKey(p.sku)) index(bySku, `${p.shop_id}|${skuKey(p.sku)}`, p.id)
    if (nameKey(p.name)) index(byName, `${p.shop_id}|${nameKey(p.name)}`, p.id)
  }

  const totals = { ...EMPTY_PIPELINE.totals }

  for (const tr of transfers) {
    let units = 0
    for (const it of tr.items || []) {
      const qty = Number(it.quantity_sent) || 0
      if (qty <= 0) continue
      units += qty
      const sku = it.source_product_id ? skuKey(sourceSku[it.source_product_id]) : ''
      const match =
        (it.destination_product_id && known.has(it.destination_product_id) ? it.destination_product_id : null)
        ?? (sku ? bySku.get(`${tr.destination_shop_id}|${sku}`) ?? null : null)
        ?? byName.get(`${tr.destination_shop_id}|${nameKey(it.product_name)}`) ?? null
      if (match) slot(match).inTransit += qty
      else totals.inTransitUnmatched += qty
    }
    if (units > 0) { totals.inTransitUnits += units; totals.inTransitTransfers += 1 }
  }

  for (const po of orders) {
    let units = 0
    for (const it of po.items || []) {
      const qty = Number(it.quantity_ordered) || 0
      if (qty <= 0) continue
      units += qty
      if (it.product_id && known.has(it.product_id)) slot(it.product_id).onOrder += qty
    }
    if (units > 0) { totals.onOrderUnits += units; totals.onOrderOrders += 1 }
  }

  return { byProduct, totals }
}

/** Lecture côté navigateur ; lève une erreur si la route ne répond pas (l'appelant garde son dernier état connu). */
export async function fetchStockPipeline(shopIds: string[]): Promise<StockPipeline> {
  if (!shopIds.length) return EMPTY_PIPELINE
  const res = await fetch(`/api/stock/pipeline?shop_ids=${shopIds.join(',')}`)
  if (!res.ok) throw new Error('pipeline')
  const json = await res.json()
  return { byProduct: json.byProduct || {}, totals: { ...EMPTY_PIPELINE.totals, ...(json.totals || {}) }, visible: json.visible }
}
