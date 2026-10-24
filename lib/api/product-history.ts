// Produits ayant un HISTORIQUE MÉTIER à conserver (décision D5 de la 179) : ils sont archivés
// (products.is_active = false, journal archive_product), jamais supprimés physiquement — pas d'erreur de clé
// étrangère, pas d'historique effacé en cascade. Suppression physique seulement d'un produit réellement vierge
// (créé par erreur) : aucune vente, aucun traitement, aucune allocation de ses lots, aucun mouvement au-delà
// de l'entrée initiale, aucun bon de commande, transfert ni inventaire.
// En cas de doute (lecture en erreur), le produit est considéré comme ayant un historique : archiver un peu plus
// souvent vaut mieux que supprimer une trace utile.

const chunk = <T,>(list: T[], size = 200): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

export async function productsWithHistory(admin: any, productIds: string[]): Promise<Set<string>> {
  const keep = new Set<string>()
  if (!productIds.length) return keep
  const mark = (rows: any[] | null | undefined, key = 'product_id') => { for (const r of rows || []) if (r?.[key]) keep.add(r[key]) }

  for (const ids of chunk(productIds)) {
    const ask = async (table: string, select: string, column = 'product_id', optional = false) => {
      const { data, error } = await admin.from(table).select(select).in(column, ids)
      if (error) {
        // Table absente avant sa migration (traitements de lots, 179) : rien à conserver de ce côté
        if (optional && ['42P01', 'PGRST205'].includes(error.code)) return []
        ids.forEach(id => keep.add(id))
        return []
      }
      return data || []
    }
    mark(await ask('sale_items', 'product_id'))
    mark(await ask('batch_treatments', 'product_id', 'product_id', true))
    mark(await ask('purchase_order_items', 'product_id'))
    mark(await ask('stock_transfer_items', 'source_product_id', 'source_product_id'), 'source_product_id')
    mark(await ask('stock_transfer_items', 'destination_product_id', 'destination_product_id'), 'destination_product_id')
    mark(await ask('inventory_counts', 'product_id'))

    // Mouvements : plus que la seule entrée initiale (création du produit avec son stock)
    const movements = await ask('stock_movements', 'product_id')
    const perProduct = new Map<string, number>()
    for (const m of movements) perProduct.set(m.product_id, (perProduct.get(m.product_id) ?? 0) + 1)
    for (const [id, n] of Array.from(perProduct.entries())) if (n > 1) keep.add(id)

    // Lots déjà vendus (allocations vente ↔ lot)
    const lots = await ask('product_batches', 'id, product_id')
    const lotOwner = new Map<string, string>(lots.map((l: any) => [l.id, l.product_id]))
    for (const lotIds of chunk(Array.from(lotOwner.keys()))) {
      const { data, error } = await admin.from('sale_item_batches').select('batch_id').in('batch_id', lotIds)
      if (error) { lotIds.forEach(id => keep.add(lotOwner.get(id)!)); continue }
      for (const a of data || []) if (a.batch_id && lotOwner.has(a.batch_id)) keep.add(lotOwner.get(a.batch_id)!)
    }
  }
  return keep
}
