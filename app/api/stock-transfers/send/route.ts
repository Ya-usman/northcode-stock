import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { getApiTranslator } from '@/lib/api/i18n'
import { isUuid, transferError, transferWorkflowAvailable } from '@/lib/api/transfers'

// POST /api/stock-transfers/send — envoie un BROUILLON (migration 188) : stock et lots de la boutique source diminuent
// (stock vendable seulement, lots FEFO), jeton de QR créé, journal écrit par la base. Renvoyer est sans effet.
// La boutique source est RELUE en base (jamais celle du navigateur) ; droit « Transferts » en modification sur elle.
// body: { transfer_id }
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const { transfer_id } = await request.json()
    if (!isUuid(transfer_id)) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })

    const admin = await createAdminClient() as any
    if (!(await transferWorkflowAvailable(admin))) return NextResponse.json({ error: t('transfer_draft_unavailable') }, { status: 503 })
    const { data: tr } = await admin.from('stock_transfers').select('source_shop_id').eq('id', transfer_id).maybeSingle()
    if (!tr) return NextResponse.json({ error: t('transfer_not_found') }, { status: 404 })
    const role = await checkShopRole(supabase, user.id, tr.source_shop_id)
    if (!role || !(await canWriteFeature(supabase, role, tr.source_shop_id, 'transfers')))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const { data, error } = await admin.rpc('send_stock_transfer_draft', { p_transfer_id: transfer_id, p_source: tr.source_shop_id, p_user: user.id })
    if (error) {
      const e = transferError(error)
      return NextResponse.json({ error: e ? t(e.key as any, e.params as any) : error.message, code: e?.key }, { status: 400 })
    }
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
