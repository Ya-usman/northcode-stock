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

    // Audit log — one entry per counting session, so a "Journal des inventaires"
    // can show who counted what and when without digging through each
    // product's individual movement history.
    if (data?.adjusted_count > 0) {
      const { data: actorProfile } = await (admin as any).from('profiles').select('full_name').eq('id', user.id).single()
      await (admin as any).from('audit_logs').insert({
        shop_id,
        actor_id: user.id,
        actor_email: user.email,
        action: 'inventory_count',
        target_id: null,
        target_type: 'inventory_count',
        metadata: {
          actor_name: actorProfile?.full_name || user.email,
          adjusted_count: data.adjusted_count,
          value_delta: data.value_delta,
          items: data.items,
        },
      }).catch(() => {}) // non-blocking
    }

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
