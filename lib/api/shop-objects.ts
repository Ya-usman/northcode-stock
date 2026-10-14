// ── Objets rattachés à une boutique ──────────────────────────────────────────
// Règle de sécurité : le shop_id envoyé par le navigateur ne suffit jamais. Une fois les droits vérifiés sur la
// boutique, tout identifiant rattaché (fournisseur, produit) doit appartenir à CETTE boutique — sinon il viendrait
// d'une autre boutique, voire d'une autre entreprise. Lectures par le client administrateur (serveur seulement).

/** Fournisseur actif de la boutique, sinon null */
export async function supplierOfShop(admin: any, supplierId: unknown, shopId: string): Promise<{ id: string; name: string } | null> {
  if (!supplierId || typeof supplierId !== 'string') return null
  const { data } = await admin.from('suppliers').select('id, name').eq('id', supplierId).eq('shop_id', shopId).is('deleted_at', null).maybeSingle()
  return data ?? null
}

/** Identifiants de produits (non vides) qui n'appartiennent PAS à la boutique — liste vide = tous rattachés */
export async function productsOutsideShop(admin: any, productIds: unknown[], shopId: string): Promise<string[]> {
  const ids = Array.from(new Set(productIds.filter((x): x is string => typeof x === 'string' && x.length > 0)))
  if (!ids.length) return []
  const { data } = await admin.from('products').select('id').in('id', ids).eq('shop_id', shopId)
  const inShop = new Set((data || []).map((p: any) => p.id))
  return ids.filter(id => !inShop.has(id))
}
