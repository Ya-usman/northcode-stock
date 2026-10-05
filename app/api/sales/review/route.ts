import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { isManagerial } from '@/lib/permissions'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'

// POST /api/sales/review { sale_id } — marque comme vérifiée une vente hors
// ligne enregistrée « à vérifier » (migration 159). Propriétaire et gestion
// (même règle que modifier / annuler une vente : historique en modification).
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const { sale_id } = await request.json().catch(() => ({}))
    if (!sale_id) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })

    const admin = await createAdminClient() as any
    const { data: sale } = await admin.from('sales').select('id, shop_id, sale_number, review_reason, reviewed_at').eq('id', sale_id).maybeSingle()
    if (!sale) return NextResponse.json({ error: t('invalid_data') }, { status: 404 })

    const role = await checkShopRole(supabase, user.id, sale.shop_id)
    if (!role || !isManagerial(role) || !(await canWriteFeature(supabase, role, sale.shop_id, 'sales_history'))) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }
    if (!sale.review_reason || sale.reviewed_at) return NextResponse.json({ success: true, unchanged: true })

    const { error } = await admin.from('sales').update({ reviewed_at: new Date().toISOString(), reviewed_by: user.id }).eq('id', sale.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAuditLog({
      action: 'sale.reviewed',
      shop_id: sale.shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: sale.id,
      target_type: 'sale',
      metadata: { sale_number: sale.sale_number, review_reason: sale.review_reason },
      ip: getClientIp(request),
    })
    return NextResponse.json({ success: true })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
