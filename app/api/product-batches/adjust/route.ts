import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { hasRolePermission } from '@/lib/api/role-permissions'
import { getApiTranslator } from '@/lib/api/i18n'

// Same permission tier as /api/product-batches/expiry and .../promo — stock
// concern, same table. cashier trusted unconditionally (see STOCK_ALWAYS_ALLOW).
const ADJUST_ALWAYS_ALLOW = ['stock_manager', 'cashier']

// PATCH /api/product-batches/adjust — correct the remaining quantity of a
// specific batch (e.g. miscount at reception). Keeps products.quantity in
// sync via the adjust_batch_quantity() SQL function (migration 117), which
// also writes the correction to stock_movements — same audit trail as a
// physical inventory count.
// body: { id, shop_id, new_quantity, reason_code }
export async function PATCH(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { id, shop_id, new_quantity, reason_code } = await request.json()
    if (!id || !shop_id) return NextResponse.json({ error: t('id_shop_id_required') }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !(await hasRolePermission(supabase, role, shop_id, 'stock', { alwaysAllow: ADJUST_ALWAYS_ALLOW })))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any
    const { data, error } = await admin.rpc('adjust_batch_quantity', {
      p_batch_id: id,
      p_shop_id: shop_id,
      p_new_quantity: new_quantity,
      p_reason_code: reason_code || 'correction',
      p_performed_by: user.id,
    })

    if (error) {
      if (error.message?.includes('batch_not_found')) return NextResponse.json({ error: t('batch_not_found') }, { status: 404 })
      if (error.message?.includes('invalid_quantity')) return NextResponse.json({ error: t('invalid_quantity') }, { status: 400 })
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
