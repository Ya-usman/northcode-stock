import { NextResponse } from 'next/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { inventoryAccess, actorNames } from '@/lib/api/inventory'

// GET /api/stock/inventory-sessions/history?shop_id= — inventaires terminés ou abandonnés de la boutique (récents d'abord)
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const shopId = new URL(request.url).searchParams.get('shop_id')
    const access = await inventoryAccess(t, shopId, 'view')
    if (!access.ok) return access.response
    const { data } = await access.admin.from('inventory_sessions')
      .select('id, reference, status, started_by, started_at, completed_by, completed_at, cancelled_by, cancelled_at, products_total, counted_total, discrepancy_total, legacy')
      .eq('shop_id', shopId).neq('status', 'in_progress').order('started_at', { ascending: false }).limit(100)
    const rows = data || []
    const names = await actorNames(access.admin, rows.flatMap((r: any) => [r.started_by, r.completed_by, r.cancelled_by]))
    return NextResponse.json({
      data: rows.map((r: any) => ({
        ...r,
        // Auteur affiché : qui a finalisé (ou abandonné), sinon qui a démarré
        by_name: names[r.completed_by || r.cancelled_by || r.started_by] ?? null,
      })),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
