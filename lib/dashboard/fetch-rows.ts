// Lectures du tableau de bord côté serveur.
//
// Deux règles, pour que les chiffres restent exacts quand la plateforme grandit :
// 1. Une requête ne lit QUE les boutiques demandées (filtre dans la requête,
//    jamais « tout lire puis trier ici ») ;
// 2. La base ne renvoie jamais plus de 1000 lignes par appel : toute lecture
//    qui peut dépasser ce nombre est faite page par page, dans un ordre fixe.

const PAGE = 1000
const MAX_PAGES = 100   // garde-fou : 100 000 lignes

// `build` renvoie une requête NEUVE à chaque page (une requête ne se rejoue pas).
export async function fetchAllRows<T = any>(build: () => any): Promise<T[]> {
  const rows: T[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await build().range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...((data || []) as T[]))
    if (!data || data.length < PAGE) break
  }
  return rows
}

// Paiements reçus par ces boutiques sur une période, hors ventes annulées,
// paiements annulés et abandons de créance ; `seller` restreint aux ventes
// d'un vendeur — un identifiant pour toutes les boutiques, ou un vendeur PAR
// boutique (décidé par le serveur, lib/api/shop-access → sellerFilter).
export type SellerScope = string | null | undefined | Record<string, string | null>
export const sellerOf = (seller: SellerScope, shopId: string): string | null =>
  seller && typeof seller === 'object' ? (seller[shopId] ?? null) : (seller || null)
export async function fetchShopPayments(admin: any, shopIds: string[], from: string, to: string, seller?: SellerScope) {
  const rows = await fetchAllRows<any>(() => admin
    .from('payments')
    .select('id, amount, paid_at, is_repayment, is_cancelled, is_write_off, sales!inner(shop_id, sale_status, cashier_id)')
    .in('sales.shop_id', shopIds)
    .gte('paid_at', from)
    .lte('paid_at', to)
    .order('paid_at', { ascending: true })
    .order('id', { ascending: true }))
  return rows.filter((p: any) =>
    shopIds.includes(p.sales?.shop_id) &&
    p.sales?.sale_status !== 'cancelled' &&
    !p.is_cancelled &&
    !p.is_write_off &&
    (!sellerOf(seller, p.sales?.shop_id) || p.sales?.cashier_id === sellerOf(seller, p.sales?.shop_id))
  )
}
