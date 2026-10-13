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
          .select('id, destination_shop_id, stock_transfer_items(source_product_id, destination_product_id, product_name, quantity_sent)')
          .in('destination_shop_id', transferShops).eq('status', 'sent')
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

  const pipelineTransfers: PipelineTransfer[] = transfers.map((tr: any) => ({ id: tr.id, destination_shop_id: tr.destination_shop_id, items: tr.stock_transfer_items || [] }))
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
