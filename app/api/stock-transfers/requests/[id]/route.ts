import { NextResponse } from 'next/server'
import { shopShortLabels } from '@/lib/shops/short-name-server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/api/shop-auth'
import { getApiTranslator } from '@/lib/api/i18n'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { REQUEST_NOTE_MAX, canDecideFor, canRequestFor, memberRole, notifyRequester } from '@/lib/api/transfer-requests'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// PATCH /api/stock-transfers/requests/<id> — { action: 'decline', reason? } (boutique qui a le stock, Transferts en
// modification) ou { action: 'cancel' } (boutique qui a demandé). Seulement une demande EN ATTENTE ; écriture
// conditionnée au statut (deux personnes en même temps : la seconde reçoit 409). L'acceptation passe par la création
// du transfert (POST /api/stock-transfers avec request_id).
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const t = getApiTranslator(request)
  try {
    if (!UUID.test(params.id)) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const action = body.action
    if (action !== 'decline' && action !== 'cancel') return NextResponse.json({ error: t('invalid_data') }, { status: 400 })

    const admin = await createAdminClient() as any
    const { data: req, error: readErr } = await admin.from('stock_transfer_requests').select('*').eq('id', params.id).maybeSingle()
    if (readErr) return NextResponse.json({ error: t('transfer_request_unavailable') }, { status: 503 })
    if (!req) return NextResponse.json({ error: t('transfer_request_not_found') }, { status: 404 })
    if (req.status !== 'pending') return NextResponse.json({ error: t('transfer_request_already_decided'), code: 'not_pending', status: req.status }, { status: 409 })

    const shopId = action === 'decline' ? req.source_shop_id : req.requesting_shop_id
    const role = await memberRole(supabase, user.id, shopId)
    const allowed = action === 'decline' ? await canDecideFor(supabase, role, shopId) : await canRequestFor(supabase, admin, role, shopId)
    if (!allowed) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const reason = action === 'decline' && typeof body.reason === 'string' ? body.reason.trim().slice(0, REQUEST_NOTE_MAX) : ''
    const now = new Date().toISOString()
    const { data: updated } = await admin.from('stock_transfer_requests')
      .update({ status: action === 'decline' ? 'declined' : 'cancelled', decline_reason: reason || null, decided_by: user.id, decided_at: now, updated_at: now })
      .eq('id', req.id).eq('status', 'pending').select('id')
    if (!updated?.length) return NextResponse.json({ error: t('transfer_request_already_decided'), code: 'not_pending' }, { status: 409 })

    await writeAuditLog({
      action: action === 'decline' ? 'stock_transfer.request_decline' : 'stock_transfer.request_cancel',
      shop_id: shopId, actor_id: user.id, actor_email: user.email, target_id: req.id, target_type: 'stock_transfer_request',
      ip: getClientIp(request), metadata: { product_name: req.product_name, quantity: req.quantity, reason: reason || null },
    })
    if (action === 'decline') {
      const { data: src } = await admin.from('shops').select('name').eq('id', req.source_shop_id).maybeSingle()
      await notifyRequester(admin, req.requesting_shop_id, req.requested_by, {
        title: t('push_transfer_request_declined_title', { shop: (await shopShortLabels(admin, [req.source_shop_id]))[req.source_shop_id] || src?.name || '' }),
        body: reason ? t('push_transfer_request_declined_body_reason', { product: req.product_name, reason }) : t('push_transfer_request_declined_body', { product: req.product_name }),
      })
    }
    return NextResponse.json({ data: { id: req.id, status: action === 'decline' ? 'declined' : 'cancelled' } })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
