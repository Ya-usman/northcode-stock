// Colonnes d'un produit qu'un écran peut lire dans le navigateur : toutes, SAUF
// le prix d'achat. Un écran qui n'a pas besoin du coût (la caisse) ne lit que
// celles-ci ; un écran qui en a besoin le demande au serveur, qui décide
// (lib/permissions → canViewCost). À tenir à jour quand une colonne est ajoutée
// à `products`.
export const PRODUCT_PUBLIC_COLUMNS = [
  'id', 'shop_id', 'name', 'name_hausa', 'sku', 'category_id', 'supplier_id',
  'selling_price', 'quantity', 'unit', 'low_stock_threshold', 'image_url', 'is_active',
  'promo_price', 'promo_until', 'promo_start', 'promo_reason', 'is_favorite',
  'created_at', 'updated_at',
].join(', ')

/** Retire le prix d'achat d'un produit reçu autrement (mise à jour en direct, ancienne donnée gardée sur l'appareil). */
export function withoutProductCost<T>(product: T): T {
  if (!product || typeof product !== 'object' || !('buying_price' in (product as any))) return product
  const { buying_price: _cost, ...rest } = product as any
  return rest as T
}
