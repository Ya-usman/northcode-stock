// Lot D des ajouts (1er nov. 2026) : un produit CRÉÉ à la réception d'un transfert (absent de la boutique d'arrivée)
// reprend la fiche du produit d'origine : code-barres (s'il est libre dans la boutique d'arrivée), seuil d'alerte,
// emplacement, catégorie de même nom dans la boutique d'arrivée (jamais celle d'une autre boutique). Le stock, les
// prix et les lots restent ceux de la réception (fonction SQL, une transaction) : ici, seulement la fiche, après coup.
// Chaque produit créé est inscrit au journal (« Produit créé », origine : le transfert), comme un ajout à la main.
import { writeAuditLog } from '@/lib/api/audit'
import { normalizeText } from '@/lib/import/products-import'

export async function completeTransferCreatedProducts(admin: any, args: {
  transferId: string; reference: string; destShopId: string; createdIds: string[]
  actor: { id: string; email?: string | null; name?: string | null }; ip: string | null
}): Promise<void> {
  const { transferId, reference, destShopId, createdIds, actor, ip } = args
  if (!createdIds.length) return
  const { data: items } = await admin.from('stock_transfer_items').select('source_product_id, destination_product_id')
    .eq('stock_transfer_id', transferId).in('destination_product_id', createdIds)
  const sourceOf = new Map<string, string>(((items || []) as any[]).filter(i => i.source_product_id).map(i => [i.destination_product_id, i.source_product_id]))
  const sourceIds = Array.from(new Set(sourceOf.values()))
  const { data: sources } = sourceIds.length
    ? await admin.from('products').select('id, shop_id, sku, category_id, low_stock_threshold, location, categories(name)').in('id', sourceIds)
    : { data: [] }
  const src = new Map<string, any>(((sources || []) as any[]).map(p => [p.id, p]))
  const { data: destCats } = await admin.from('categories').select('id, name').eq('shop_id', destShopId)
  const catByName = new Map<string, string>(((destCats || []) as { id: string; name: string }[]).map(c => [normalizeText(c.name), c.id]))
  const { data: tr } = await admin.from('stock_transfers').select('source_shop_id').eq('id', transferId).maybeSingle()
  const { data: srcShop } = tr?.source_shop_id ? await admin.from('shops').select('name').eq('id', tr.source_shop_id).maybeSingle() : { data: null }
  const fromShop = srcShop?.name ?? null

  for (const id of createdIds) {
    const s = src.get(sourceOf.get(id) || '')
    const patch: Record<string, unknown> = {}
    if (s) {
      if (s.low_stock_threshold !== null && s.low_stock_threshold !== undefined) patch.low_stock_threshold = s.low_stock_threshold
      if (s.location) patch.location = s.location
      const cat = s.categories?.name ? catByName.get(normalizeText(s.categories.name)) : undefined
      if (cat) patch.category_id = cat
    }
    if (Object.keys(patch).length) await admin.from('products').update(patch).eq('id', id).eq('shop_id', destShopId)
    // Code-barres à part : refusé par la base s'il est déjà pris dans la boutique d'arrivée (contrainte unique), sans
    // bloquer le reste de la fiche
    let skuCopied = false
    if (s?.sku) {
      const { error } = await admin.from('products').update({ sku: s.sku }).eq('id', id).eq('shop_id', destShopId)
      skuCopied = !error
    }
    const { data: p } = await admin.from('products').select('name, selling_price, quantity, is_active').eq('id', id).maybeSingle()
    await writeAuditLog({
      action: 'create_product', shop_id: destShopId, actor_id: actor.id, actor_email: actor.email ?? null,
      target_id: id, target_type: 'product', ip,
      metadata: {
        actor_name: actor.name || actor.email, product_name: p?.name, selling_price: p?.selling_price, quantity: p?.quantity,
        source: 'transfer', reference, from_shop: fromShop, needs_price: p ? p.is_active === false : undefined,
        copied: { ...Object.fromEntries(Object.keys(patch).map(k => [k, true])), ...(skuCopied ? { sku: true } : {}) },
      },
    })
  }
}
