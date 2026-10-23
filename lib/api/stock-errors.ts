// Erreurs de stock / fuseau renvoyées par la base (migration 178) → message lisible pour la caisse, la
// modification d'une vente et la gestion des boutiques. Jamais le message SQL brut (identifiant de produit…).
//   P0001 : stock physique insuffisant ;
//   P0030 : stock présent mais quantité VENDABLE insuffisante (lots périmés), détail {sellable, non_sellable} ;
//   P0031 : fuseau invalide ou incohérent avec le pays ; P0032 : fuseau obligatoire (pays à plusieurs fuseaux).

type T = (key: any, values?: any) => string

function detailOf(error: any): Record<string, any> {
  try { return error?.details ? JSON.parse(error.details) : {} } catch { return {} }
}

/** Nom du produit d'après les lignes de la requête (repli : « ce produit ») */
function nameOf(items: any[] | undefined, productId: string | undefined, t: T): string {
  const line = (items || []).find((i: any) => i?.product_id === productId)
  return (line?.product_name && String(line.product_name)) || t('stock_this_product')
}

export function saleStockErrorResponse(error: any, items: any[] | undefined, t: T): { status: number; body: Record<string, unknown> } | null {
  if (!error) return null
  if (error.code === 'P0030') {
    const d = detailOf(error)
    return { status: 409, body: {
      error: t('sale_sellable_insufficient', { name: nameOf(items, d.product_id, t), available: Number(d.sellable) || 0, non_sellable: Number(d.non_sellable) || 0 }),
      code: 'sellable_insufficient', product_id: d.product_id ?? null, sellable: Number(d.sellable) || 0, non_sellable: Number(d.non_sellable) || 0,
    } }
  }
  if (error.code === 'P0001') {
    const m = String(error.message || '').match(/produit ([0-9a-f-]{36}) \(disponible: (-?\d+), demandé: (\d+)\)/i)
    return { status: 409, body: {
      error: t('sale_stock_insufficient', { name: nameOf(items, m?.[1], t), available: m ? Math.max(0, Number(m[2])) : 0 }),
      code: 'stock_insufficient', product_id: m?.[1] ?? null,
    } }
  }
  return null
}

export function shopTimezoneErrorResponse(error: any, t: T): { status: number; body: Record<string, unknown> } | null {
  if (error?.code === 'P0032') return { status: 400, body: { error: t('shop_timezone_required'), code: 'shop_timezone_required', field: 'timezone' } }
  if (error?.code === 'P0031') return { status: 400, body: { error: t('shop_timezone_invalid'), code: 'shop_timezone_invalid', field: 'timezone' } }
  return null
}
