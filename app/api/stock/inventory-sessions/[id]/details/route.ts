import { NextResponse } from 'next/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { inventoryAccess, inventoryDbError, isUuid, isRealDay } from '@/lib/api/inventory'

const REASONS = ['correction', 'damage', 'loss', 'theft', 'expiry', 'other']

// POST /api/stock/inventory-sessions/:id/details — vérification d'un écart : motif, et pour un écart positif la date
// de péremption des unités retrouvées (facultative ; date du calendrier vérifiée, jamais corrigée ni inventée)
// body: { shop_id, count_id, reason, surplus_expiry_date }
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const t = getApiTranslator(request)
  try {
    const { shop_id, count_id, reason, surplus_expiry_date } = await request.json()
    const access = await inventoryAccess(t, shop_id, 'write')
    if (!access.ok) return access.response
    if (!isUuid(params.id) || !isUuid(count_id)) return NextResponse.json({ error: t('inventory_count_not_found') }, { status: 400 })
    if (reason != null && !REASONS.includes(reason)) return NextResponse.json({ error: t('inventory_invalid_reason') }, { status: 400 })
    const date = typeof surplus_expiry_date === 'string' && surplus_expiry_date.trim() ? surplus_expiry_date.trim() : null
    if (date && !isRealDay(date)) return NextResponse.json({ error: t('date_invalid') }, { status: 400 })
    // La ligne doit appartenir à CETTE session (la fonction vérifie la boutique et que la session est en cours)
    const { data: line } = await access.admin.from('inventory_counts').select('id').eq('id', count_id).eq('session_id', params.id).maybeSingle()
    if (!line) return NextResponse.json({ error: t('inventory_count_not_found') }, { status: 404 })
    const { error } = await access.admin.rpc('set_inventory_count_details', {
      p_count_id: count_id, p_shop_id: shop_id, p_reason: reason ?? null, p_surplus_expiry_date: date,
    })
    if (error) return inventoryDbError(t, error)
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
