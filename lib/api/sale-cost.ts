// Coût d'achat d'une vente : décidé par le SERVEUR, jamais par l'appareil.
//
// Une seule règle pour l'encaissement en ligne (/api/sales/checkout) et pour la
// synchronisation des ventes hors ligne (/api/sales/sync) : le coût d'une
// ligne est le prix d'achat de la fiche produit AU MOMENT de l'enregistrement
// (coût moyen pondéré tenu à la réception, migration 085). Ce que l'appareil
// envoie dans `buying_price` est ignoré — une caisse n'a pas à connaître ce
// prix, et ne peut donc pas fausser les marges.
//
// Les réponses renvoyées à l'appareil (vente créée, pour le reçu) sont rendues
// sans ce coût : `withoutCost`.

type Admin = { from: (table: string) => any }

/** Lignes de vente avec le coût lu en base (0 pour une ligne libre ou un produit inconnu de la boutique). */
export async function withServerCost<T extends { product_id?: string | null }>(
  admin: Admin,
  shopId: string,
  items: T[],
): Promise<(Omit<T, 'buying_price'> & { buying_price: number })[]> {
  const ids = Array.from(new Set(items.map(i => i?.product_id).filter(Boolean))) as string[]
  const cost = new Map<string, number>()
  const CHUNK = 100
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await admin.from('products').select('id, buying_price').eq('shop_id', shopId).in('id', ids.slice(i, i + CHUNK))
    if (error) throw error
    for (const p of data || []) cost.set(p.id, Number(p.buying_price) || 0)
  }
  return items.map(i => ({ ...i, buying_price: i?.product_id ? cost.get(i.product_id) ?? 0 : 0 }))
}

/** La vente telle qu'elle peut être renvoyée à l'appareil : sans le coût d'achat de ses lignes. */
export function withoutCost<T>(sale: T): T {
  if (!sale || typeof sale !== 'object') return sale
  const s = sale as any
  if (!Array.isArray(s.sale_items)) return sale
  return { ...s, sale_items: s.sale_items.map(({ buying_price: _cost, ...line }: any) => line) }
}
