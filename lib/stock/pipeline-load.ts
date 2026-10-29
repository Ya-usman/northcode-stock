import { fetchAllRows } from '@/lib/dashboard/fetch-rows'
import { computeStockPipeline, type PipelineOrder, type PipelineProduct, type PipelineTransfer } from '@/lib/stock/pipeline'

// Lecture serveur du stock « à venir » (rôle de service), partagée par
// /api/stock/pipeline et la fiche produit : une seule façon de lire les
// transferts envoyés et les bons de commande envoyés. Les droits sont décidés
// par l'appelant : une liste de boutiques vide = information non lue.
export async function loadStockPipeline(
  admin: any,
  scope: { stockShops: string[]; transferShops: string[]; orderShops: string[] },
) {
  const { stockShops, transferShops, orderShops } = scope
  const [products, transfers, orders] = await Promise.all([
    fetchAllRows<PipelineProduct>(() => admin
      .from('products').select('id, shop_id, name, sku')
      .in('shop_id', stockShops).eq('is_active', true)
      .order('id', { ascending: true })),
    transferShops.length
      ? fetchAllRows<any>(() => admin
          .from('stock_transfers')
          .select('id, status, destination_shop_id, stock_transfer_items(id, source_product_id, destination_product_id, product_name, quantity_sent, quantity_received)')
          .in('destination_shop_id', transferShops).in('status', ['sent', 'partially_received'])
          .order('id', { ascending: true }))
      : Promise.resolve([]),
    orderShops.length
      ? fetchAllRows<any>(() => admin
          .from('purchase_orders')
          .select('id, shop_id, purchase_order_items(product_id, quantity_ordered)')
          .in('shop_id', orderShops).eq('status', 'sent')
          .order('id', { ascending: true }))
      : Promise.resolve([]),
  ])

  // Quantité réellement en route par ligne : allocations de la 188 (reçu, rendu et perdu déduits) ; avant la 188,
  // envoyé − reçu. La ligne garde son nom quantity_sent pour le calcul du pipeline.
  const transit = await inTransitByItem(admin, transfers.map((tr: any) => tr.id))
  const pipelineTransfers: PipelineTransfer[] = transfers.map((tr: any) => ({
    id: tr.id, destination_shop_id: tr.destination_shop_id,
    items: (tr.stock_transfer_items || []).map((it: any) => ({
      ...it,
      quantity_sent: transit ? (transit[it.id] ?? 0) : Math.max(0, (Number(it.quantity_sent) || 0) - (Number(it.quantity_received) || 0)),
    })).filter((it: any) => it.quantity_sent > 0),
  }))
  const pipelineOrders: PipelineOrder[] = orders.map((po: any) => ({ id: po.id, shop_id: po.shop_id, items: po.purchase_order_items || [] }))

  // Code-barres des produits d'origine des transferts (rattachement côté destination)
  const sourceIds = Array.from(new Set(pipelineTransfers.flatMap(tr => tr.items.map(i => i.source_product_id).filter(Boolean)))) as string[]
  const sourceSku: Record<string, string | null> = {}
  if (sourceIds.length) {
    const { data: src } = await admin.from('products').select('id, sku').in('id', sourceIds)
    for (const p of src || []) sourceSku[p.id] = p.sku
  }

  return computeStockPipeline(products, pipelineTransfers, pipelineOrders, sourceSku)
}

/** Reste en route par ligne de transfert (migration 188) ; null avant la 188 (tables absentes) */
async function inTransitByItem(admin: any, transferIds: string[]): Promise<Record<string, number> | null> {
  if (!transferIds.length) return {}
  const { data, error } = await admin.from('stock_transfer_allocations').select('item_id, quantity_in_transit').in('transfer_id', transferIds)
  if (error) return null
  const out: Record<string, number> = {}
  for (const a of (data || []) as any[]) out[a.item_id] = (out[a.item_id] || 0) + (Number(a.quantity_in_transit) || 0)
  return out
}
