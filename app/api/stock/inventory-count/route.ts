import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'

const WRITE_ROLES = ['owner', 'manager', 'shop_manager', 'stock_manager', 'super_admin']

// POST /api/stock/inventory-count — apply a batch of physical stock counts
// body: { shop_id, items: [{ product_id, counted_qty }] }
export async function POST(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { shop_id, items } = await request.json()
    if (!shop_id || !Array.isArray(items) || items.length === 0)
      return NextResponse.json({ error: 'shop_id et items requis' }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !WRITE_ROLES.includes(role))
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

    const admin = await createAdminClient()
    const { data, error } = await (admin as any).rpc('apply_inventory_count', {
      p_shop_id: shop_id,
      p_performed_by: user.id,
      p_items: items,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// GET /api/stock/inventory-count?shop_id= — most recent count session, for
// comparing "what did we count last time" against the current count.
export async function GET(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const shopId = searchParams.get('shop_id')
    if (!shopId) return NextResponse.json({ error: 'shop_id requis' }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shopId)
    if (!role || !WRITE_ROLES.includes(role))
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

    const admin = await createAdminClient()

    const { data: latest } = await (admin as any)
      .from('stock_movements')
      .select('count_session_id, created_at')
      .eq('shop_id', shopId)
      .not('count_session_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!latest?.count_session_id) return NextResponse.json({ session: null })

    const { data: rows } = await (admin as any)
      .from('stock_movements')
      .select('product_id, previous_qty, new_qty, reason')
      .eq('count_session_id', latest.count_session_id)

    const items: Record<string, { countedQty: number; previousQty: number; reasonLabel: string | null }> = {}
    for (const r of rows || []) {
      if (r.product_id == null || r.new_qty == null || r.previous_qty == null) continue
      // reason is stored as "Inventaire physique — <label>" — only surface the
      // label, and only when it's more informative than the default fallback.
      const label = String(r.reason || '').split(' — ')[1] || null
      items[r.product_id] = {
        countedQty: r.new_qty,
        previousQty: r.previous_qty,
        reasonLabel: label && label !== 'Correction de stock' ? label : null,
      }
    }

    return NextResponse.json({ session: { countedAt: latest.created_at, items } })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
