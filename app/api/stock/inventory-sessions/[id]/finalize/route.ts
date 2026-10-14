import { NextResponse } from 'next/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { inventoryAccess, inventoryDbError, isUuid } from '@/lib/api/inventory'

// POST /api/stock/inventory-sessions/:id/finalize — appliquer les écarts au stock DU MOMENT (une seule transaction,
// idempotente ; journal écrit dans la même transaction). Réponses : status 'completed' (already_completed si déjà
// faite) ou 'recount_required' avec la liste des produits dont le stock deviendrait négatif (rien n'est appliqué).
// body: { shop_id }
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const t = getApiTranslator(request)
  try {
    const { shop_id } = await request.json()
    const access = await inventoryAccess(t, shop_id, 'write')
    if (!access.ok) return access.response
    if (!isUuid(params.id)) return NextResponse.json({ error: t('inventory_session_not_found') }, { status: 404 })
    const { data, error } = await access.admin.rpc('finalize_inventory_session', { p_session_id: params.id, p_shop_id: shop_id, p_user: access.userId })
    if (error) return inventoryDbError(t, error)
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
