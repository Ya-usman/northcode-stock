import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { hasRolePermission } from '@/lib/api/role-permissions'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'

// POST /api/sales/postpone-due-date — reporte l'échéance d'une vente à
// crédit. Même permission que le reste de la gestion de dette ('payments'),
// pas de limite de nombre de reports (décision explicite — ce n'est pas un
// enjeu d'accès/sécurité comme la prolongation d'horaires).
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { sale_id, shop_id, new_due_date, reason } = await request.json()
    if (!sale_id || !shop_id || !new_due_date) {
      return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    }
    if (isNaN(new Date(new_due_date).getTime())) {
      return NextResponse.json({ error: t('date_invalid') }, { status: 400 })
    }

    const role = await checkShopRole(supabase, user.id, shop_id)
    if (!role || !(await hasRolePermission(supabase, role, shop_id, 'payments'))) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }

    const admin = await createAdminClient() as any
    const { data: before } = await admin
      .from('sales')
      .select('due_date, sale_number')
      .eq('id', sale_id)
      .eq('shop_id', shop_id)
      .single()
    if (!before) return NextResponse.json({ error: t('sale_not_found') }, { status: 404 })

    const { error } = await admin
      .from('sales')
      .update({ due_date: new_due_date })
      .eq('id', sale_id)
      .eq('shop_id', shop_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    await writeAuditLog({
      action: 'sale.postpone_due_date',
      shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: sale_id,
      target_type: 'sale',
      metadata: { sale_number: before.sale_number, old_due_date: before.due_date, new_due_date, reason: reason || null },
      ip: getClientIp(request),
    })

    return NextResponse.json({ success: true, due_date: new_due_date })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
