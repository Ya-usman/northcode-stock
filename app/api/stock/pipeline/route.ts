import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { canViewFeature } from '@/lib/api/role-permissions'
import { fetchAllRows } from '@/lib/dashboard/fetch-rows'
import { computeStockPipeline, type PipelineOrder, type PipelineProduct, type PipelineTransfer } from '@/lib/stock/pipeline'

// GET /api/stock/pipeline?shop_ids=a,b
// Stock « à venir » des boutiques demandées : en transit (transferts envoyés
// vers elles, non reçus) et commandé (bons de commande envoyés, non reçus).
// Lecture seule. Règles dans lib/stock/pipeline.
//
// Droits, boutique par boutique : il faut voir le Stock ; les transferts ne
// sont comptés que si la personne voit les Transferts, les commandes que si
// elle voit les Fournisseurs. Ce qui n'est pas autorisé est simplement absent
// (signalé par `visible`), jamais renvoyé à zéro comme si rien n'était attendu.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const shopIds = (new URL(request.url).searchParams.get('shop_ids') || '').split(',').map(s => s.trim()).filter(Boolean)
    if (!shopIds.length) return NextResponse.json({ error: t('shop_ids_required') }, { status: 400 })

    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { data: members } = await supabase
      .from('shop_members').select('shop_id, role')
      .in('shop_id', shopIds).eq('user_id', user.id).eq('is_active', true)

    const stockShops: string[] = [], transferShops: string[] = [], orderShops: string[] = []
    await Promise.all((members || []).map(async (m: any) => {
      if (!(await canViewFeature(supabase, m.role, m.shop_id, 'stock'))) return
      stockShops.push(m.shop_id)
      const [tr, po] = await Promise.all([
        canViewFeature(supabase, m.role, m.shop_id, 'transfers'),
        canViewFeature(supabase, m.role, m.shop_id, 'suppliers'),
      ])
      if (tr) transferShops.push(m.shop_id)
      if (po) orderShops.push(m.shop_id)
    }))
    if (!stockShops.length) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any

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

    const pipeline = computeStockPipeline(products, pipelineTransfers, pipelineOrders, sourceSku)
    return NextResponse.json({
      ...pipeline,
      visible: {
        inTransit: transferShops.length === stockShops.length,
        onOrder: orderShops.length === stockShops.length,
      },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
