// Classement « Top produits » du tableau de bord — règle unique, utilisée par
// la vue « Semaine » (calculée dans le navigateur) et par les vues « Mois » /
// « Année » (/api/dashboard/top-products).
//
// 1. Dans une boutique, les ventes sont regroupées par identifiant de produit
//    (jamais par nom seul : un produit renommé resterait coupé en deux, et deux
//    produits différents portant le même nom seraient confondus).
// 2. En vue « Toutes les boutiques », chaque boutique a sa propre fiche du même
//    produit : ces fiches sont réunies en une seule ligne quand elles portent le
//    même nom (sans tenir compte des majuscules, des accents ni des espaces en
//    trop) ET viennent de boutiques différentes. Deux fiches de même nom dans
//    UNE boutique restent deux lignes, comme en vue d'une seule boutique.

export interface TopProductRow { name: string; quantity: number; revenue: number }

interface SaleItemLike { product_id?: string | null; product_name: string; quantity: number | string; subtotal: number | string }
interface SaleLike { shop_id?: string | null; sale_items?: SaleItemLike[] | null }

const sameNameKey = (name: string) =>
  (name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

export function computeTopProducts(sales: SaleLike[] | null | undefined, limit = 5): TopProductRow[] {
  // 1. Une ligne par fiche produit (ou par libellé pour un article saisi librement)
  const perProduct = new Map<string, TopProductRow & { shop: string; free: boolean }>()
  for (const sale of sales || []) {
    const shop = sale.shop_id || ''
    for (const item of sale.sale_items || []) {
      const free = !item.product_id
      const key = free ? `libre:${item.product_name}` : String(item.product_id)
      let row = perProduct.get(key)
      if (!row) { row = { name: item.product_name, quantity: 0, revenue: 0, shop, free }; perProduct.set(key, row) }
      row.quantity += Number(item.quantity)
      row.revenue += Number(item.subtotal)
    }
  }

  // 2. Même produit dans plusieurs boutiques → une seule ligne
  const merged: (TopProductRow & { shops: Set<string> })[] = []
  const byName = new Map<string, (TopProductRow & { shops: Set<string> })[]>()
  for (const row of Array.from(perProduct.values())) {
    const nameKey = sameNameKey(row.name)
    const candidates = byName.get(nameKey) || []
    // Sans boutique connue ou article libre : aucune réunion (comportement d'origine)
    const target = row.free || !row.shop ? undefined : candidates.find(c => !c.shops.has(row.shop) && !c.shops.has(''))
    if (target) {
      target.quantity += row.quantity
      target.revenue += row.revenue
      target.shops.add(row.shop)
    } else {
      const entry = { name: row.name, quantity: row.quantity, revenue: row.revenue, shops: new Set([row.free ? '' : row.shop]) }
      merged.push(entry)
      byName.set(nameKey, [...candidates, entry])
    }
  }

  return merged
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit)
    .map(({ name, quantity, revenue }) => ({ name, quantity, revenue }))
}
