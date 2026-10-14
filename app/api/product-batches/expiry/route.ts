import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { getApiTranslator } from '@/lib/api/i18n'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

// Lots = niveau « modification » de Produits / Stock (règle unique, lot 1).
// PATCH /api/product-batches/expiry — correct or clear a batch's expiry
// date (e.g. it was set by mistake on a product that doesn't expire).
// Dedicated route for the same reason as .../promo: product_batches' UPDATE
// RLS is open to any shop member (needed for the FEFO depletion trigger on
// sale), so the role check has to live here instead.
// body: { id, shop_id, expiry_date } — expiry_date: 'YYYY-MM-DD' or null to clear.
// La date change le statut du lot (sain, expire bientôt, périmé) et donc le « Disponible » : chaque
// modification est inscrite au journal d'activité (ancienne et nouvelle date), comme la promo d'un lot.
export async function PATCH(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { id, shop_id, expiry_date } = await request.json()
    if (!id || !shop_id) return NextResponse.json({ error: t('id_shop_id_required') }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !(await canWriteFeature(supabase, role, shop_id, 'stock')))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    if (expiry_date !== null && isNaN(new Date(expiry_date).getTime()))
      return NextResponse.json({ error: t('date_invalid') }, { status: 400 })

    const admin = await createAdminClient() as any

    const { data: before } = await admin
      .from('product_batches')
      .select('expiry_date, product_id')
      .eq('id', id)
      .eq('shop_id', shop_id)
      .maybeSingle()

    const { data, error } = await admin
      .from('product_batches')
      .update({ expiry_date: expiry_date ?? null })
      .eq('id', id)
      .eq('shop_id', shop_id)
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (!data) return NextResponse.json({ error: t('batch_not_found') }, { status: 404 })

    if (before && (before.expiry_date ?? null) !== (data.expiry_date ?? null)) {
      const { data: product } = await admin.from('products').select('name').eq('id', before.product_id).single()
      const { data: actorProfile } = await admin.from('profiles').select('full_name').eq('id', user.id).single()
      await writeAuditLog({
        action: 'update_batch_expiry',
        shop_id, actor_id: user.id, actor_email: user.email,
        target_id: id, target_type: 'product_batch',
        ip: getClientIp(request),
        metadata: {
          actor_name: actorProfile?.full_name || user.email,
          product_name: product?.name || null,
          product_id: before.product_id,
          old_date: before.expiry_date ?? null,
          new_date: data.expiry_date ?? null,
        },
      })
    }

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
