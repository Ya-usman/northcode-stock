import { NextResponse } from 'next/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { inventoryAccess, actorNames, isUuid, COUNT_COLUMNS } from '@/lib/api/inventory'

// GET /api/stock/inventory-sessions/:id?shop_id= — détail d'un inventaire (lecture seule) : comptages retenus
// (les recomptages remplacés restent en base, non affichés ici). La session doit appartenir à la boutique demandée.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const t = getApiTranslator(request)
  try {
    const shopId = new URL(request.url).searchParams.get('shop_id')
    const access = await inventoryAccess(t, shopId, 'view')
    if (!access.ok) return access.response
    if (!isUuid(params.id)) return NextResponse.json({ error: t('inventory_session_not_found') }, { status: 404 })
    const { data: session } = await access.admin.from('inventory_sessions')
      .select('id, reference, status, started_by, started_at, completed_by, completed_at, cancelled_by, cancelled_at, products_total, counted_total, discrepancy_total, legacy')
      .eq('id', params.id).eq('shop_id', shopId).maybeSingle()
    if (!session) return NextResponse.json({ error: t('inventory_session_not_found') }, { status: 404 })
    const { data: counts } = await access.admin.from('inventory_counts').select(COUNT_COLUMNS)
      .eq('session_id', params.id).is('superseded_at', null).order('product_name')
    const names = await actorNames(access.admin, [session.started_by, session.completed_by, session.cancelled_by, ...(counts || []).map((c: any) => c.counted_by)])
    return NextResponse.json({
      session: {
        ...session,
        started_by_name: names[session.started_by] ?? null,
        completed_by_name: names[session.completed_by] ?? null,
        cancelled_by_name: names[session.cancelled_by] ?? null,
      },
      counts: (counts || []).map((c: any) => ({ ...c, counted_by_name: names[c.counted_by] ?? null })),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
