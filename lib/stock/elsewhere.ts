// « Disponible ailleurs » (décisions du 30 oct. 2026) : règles PURES, partagées par le serveur et les tests.
// Un produit d'une boutique est retrouvé dans une autre boutique de la même entreprise par son code-barres
// (référence), sinon par son nom exact (sans accents ni casse). Un code ou un nom porté par PLUSIEURS produits de la
// boutique est ambigu : on ne rattache pas (jamais d'erreur affichée au client). Même règle que le stock en transit
// (lib/stock/pipeline).

export const nameKey = (name: string | null | undefined) =>
  (name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
export const skuKey = (sku: string | null | undefined) => (sku || '').trim().toLowerCase()

export interface MatchProduct { id: string; shop_id: string; name: string; sku: string | null }

/** Index des produits par boutique : code-barres et nom ; null = ambigu */
export function buildProductIndex(products: MatchProduct[]) {
  const bySku = new Map<string, string | null>()
  const byName = new Map<string, string | null>()
  const put = (map: Map<string, string | null>, key: string, id: string) => map.set(key, map.has(key) ? null : id)
  for (const p of products) {
    if (skuKey(p.sku)) put(bySku, `${p.shop_id}|${skuKey(p.sku)}`, p.id)
    if (nameKey(p.name)) put(byName, `${p.shop_id}|${nameKey(p.name)}`, p.id)
  }
  return { bySku, byName }
}

/** Produit correspondant dans une autre boutique, ou null (absent ou ambigu) */
export function matchIn(index: ReturnType<typeof buildProductIndex>, shopId: string, product: { name: string; sku: string | null }): string | null {
  const sku = skuKey(product.sku)
  if (sku) {
    const bySku = index.bySku.get(`${shopId}|${sku}`)
    if (bySku !== undefined) return bySku // trouvé, ou ambigu (null) : on ne retombe pas sur le nom
  }
  const byName = index.byName.get(`${shopId}|${nameKey(product.name)}`)
  return byName ?? null
}

export interface ElsewhereShop {
  shop_id: string
  name: string
  city: string | null
  phone: string | null
  open: boolean
  closes_at: string | null
  source_product_id: string
  available: number
  /** Quantité déjà demandée à cette boutique pour ce produit (demande en attente) */
  pending: number
}

/** Ordre d'affichage : boutiques ouvertes d'abord, puis la plus grande quantité, puis le nom */
export function sortElsewhere(shops: ElsewhereShop[]): ElsewhereShop[] {
  return [...shops].sort((a, b) => Number(b.open) - Number(a.open) || b.available - a.available || a.name.localeCompare(b.name))
}

/** Quantité proposée par défaut pour une demande : ce qui manque pour atteindre le seuil (au moins 1), plafonnée */
export function defaultRequestQty(opts: { available: number; threshold: number; localAvailable: number }): number {
  const missing = Math.max(1, Math.max(0, opts.threshold) - Math.max(0, opts.localAvailable))
  return Math.max(1, Math.min(missing, Math.max(1, opts.available)))
}
