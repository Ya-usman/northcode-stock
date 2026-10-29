import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'
import { isUuid, transferError, transferWorkflowAvailable } from '@/lib/api/transfers'

// POST /api/stock-transfers/cancel — annule un brouillon, ou un transfert en transit dont rien n'a été reçu (tout
// revient dans les lots source EXACTS, migration 188) ; jamais après réception. La boutique source est relue en base ;
// droit « Transferts » en modification sur elle.
// body: { transfer_id }
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const { transfer_id } = await request.json()
    if (!isUuid(transfer_id)) return NextResponse.json({ error: t('transfer_source_id_required') }, { status: 400 })

    const admin = await createAdminClient() as any
    const { data: tr } = await admin.from('stock_transfers').select('source_shop_id, reference').eq('id', transfer_id).maybeSingle()
    if (!tr) return NextResponse.json({ error: t('transfer_not_found') }, { status: 404 })
    const role = await checkShopRole(supabase, user.id, tr.source_shop_id)
    if (!role || !(await canWriteFeature(supabase, role, tr.source_shop_id, 'transfers')))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const workflow = await transferWorkflowAvailable(admin)
    const { error } = await admin.rpc('cancel_stock_transfer', { p_transfer_id: transfer_id, p_source_shop_id: tr.source_shop_id, p_performed_by: user.id })
    if (error) {
      const e = transferError(error)
      return NextResponse.json({ error: e ? t(e.key as any, e.params as any) : error.message, code: e?.key }, { status: 400 })
    }
    if (!workflow) {
      const { data: actorProfile } = await admin.from('profiles').select('full_name').eq('id', user.id).single()
      await writeAuditLog({
        action: 'stock_transfer.cancel', shop_id: tr.source_shop_id, actor_id: user.id, actor_email: user.email,
        target_id: transfer_id, target_type: 'stock_transfer', ip: getClientIp(request),
        metadata: { actor_name: actorProfile?.full_name || user.email, reference: tr.reference },
      })
    }
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
