import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { getApiTranslator } from '@/lib/api/i18n'

// Lots = niveau « modification » de Produits / Stock (règle unique, lot 1).
// DELETE /api/product-batches?id=&shop_id= — permanently delete an
// erroneous batch (e.g. a duplicate created by mistake). Refused by
// delete_product_batch() (migration 117) if the batch has already been
// sold from, since that would break precise stock restoration on a sale
// cancellation — a quantity correction (.../adjust) must be used instead.
// body: { id, shop_id, reason_code }
export async function DELETE(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { id, shop_id, reason_code } = await request.json()
    if (!id || !shop_id) return NextResponse.json({ error: t('id_shop_id_required') }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !(await canWriteFeature(supabase, role, shop_id, 'stock')))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any
    const { data, error } = await admin.rpc('delete_product_batch', {
      p_batch_id: id,
      p_shop_id: shop_id,
      p_reason_code: reason_code || 'correction',
      p_performed_by: user.id,
    })

    if (error) {
      if (error.message?.includes('batch_not_found')) return NextResponse.json({ error: t('batch_not_found') }, { status: 404 })
      if (error.message?.includes('batch_already_sold')) return NextResponse.json({ error: t('batch_already_sold') }, { status: 409 })
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
