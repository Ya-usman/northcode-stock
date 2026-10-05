import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { checkRateLimit } from '@/lib/rate-limit'
import { getApiTranslator } from '@/lib/api/i18n'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { canWriteFeature, isManagerial } from '@/lib/api/role-permissions'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Direction (propriétaire, Manager, Responsable, support) avec « Clients » en
// modification — jamais le caissier ni l'Observateur

// POST /api/customers/merge — fusionne un doublon (merge_id) dans la fiche
// gardée (keep_id) : merge_customers (migration 151), en une transaction,
// puis journal d'audit. Décision humaine uniquement : rien n'est fusionné
// automatiquement, deux « Job » peuvent être deux personnes.
export async function POST(request: Request) {
  const limited = await checkRateLimit(request, 'api')
  if (limited) return limited

  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { shop_id, keep_id, merge_id } = await request.json()
    if (![shop_id, keep_id, merge_id].every(v => typeof v === 'string' && UUID.test(v)) || keep_id === merge_id) {
      return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    }

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !isManagerial(role) || !(await canWriteFeature(supabase, role, shop_id, 'customers'))) {
      return NextResponse.json({ error: t('merge_forbidden') }, { status: 403 })
    }

    const admin = await createAdminClient() as any
    const { data, error } = await admin.rpc('merge_customers', { p_shop_id: shop_id, p_keep_id: keep_id, p_merge_id: merge_id })
    if (error) {
      const code = (error as any).code
      const key = code === 'P0010' ? 'merge_same_customer'
        : code === 'P0011' ? 'customer_not_found'
        : code === 'P0012' ? 'customer_unavailable'
        : null
      return NextResponse.json({ error: key ? t(key) : error.message }, { status: 400 })
    }

    await writeAuditLog({
      action: 'customer.merged',
      shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: keep_id,
      target_type: 'customer',
      ip: getClientIp(request),
      metadata: {
        merged_id: merge_id,
        kept_name: data?.kept_name,
        merged_name: data?.merged_name,
        sales_moved: data?.sales_moved,
        debt_moved: data?.debt_moved,
      },
    })

    return NextResponse.json({ success: true, ...data })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
