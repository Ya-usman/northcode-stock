import { NextResponse } from 'next/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { inventoryAccess, inventoryDbError, actorNames, isUuid } from '@/lib/api/inventory'

// POST /api/stock/inventory-sessions/:id/count — enregistrer le comptage d'un produit
// body: { shop_id, product_id, counted_qty, expected_count_id } — expected_count_id = ligne courante connue de
// l'appareil (null s'il n'y en avait pas). Si un autre employé a compté entre-temps : rien n'est écrit, la réponse
// { conflict, current } donne le comptage actuel ; l'écran demande de confirmer, puis renvoie avec ce nouvel id.
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const t = getApiTranslator(request)
  try {
    const { shop_id, product_id, counted_qty, expected_count_id } = await request.json()
    const access = await inventoryAccess(t, shop_id, 'write')
    if (!access.ok) return access.response
    const qty = Number(counted_qty)
    if (!isUuid(params.id) || !isUuid(product_id) || !Number.isInteger(qty) || qty < 0)
      return NextResponse.json({ error: t('inventory_invalid_quantity') }, { status: 400 })
    const { data, error } = await access.admin.rpc('record_inventory_count', {
      p_session_id: params.id, p_shop_id: shop_id, p_product_id: product_id, p_counted_qty: qty,
      p_user: access.userId, p_expected_count_id: isUuid(expected_count_id) ? expected_count_id : null,
    })
    if (error) return inventoryDbError(t, error)
    if (data?.conflict && data.current?.counted_by) {
      const names = await actorNames(access.admin, [data.current.counted_by])
      data.current.counted_by_name = names[data.current.counted_by] ?? null
    }
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
