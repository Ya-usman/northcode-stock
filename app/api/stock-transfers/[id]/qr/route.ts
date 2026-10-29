import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canViewFeature } from '@/lib/api/role-permissions'
import { getApiTranslator } from '@/lib/api/i18n'
import { isUuid, transferQrUrl, transferWorkflowAvailable } from '@/lib/api/transfers'

// GET /api/stock-transfers/[id]/qr?locale=fr — contenu du QR d'un transfert EN TRANSIT (adresse de réception avec
// l'identifiant et le jeton). Droit « Transferts » en lecture dans la source OU la destination. Le jeton n'autorise
// rien à lui seul : le scan revérifie la boutique, le membre et le droit.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    if (!isUuid(params.id)) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    const admin = await createAdminClient() as any
    if (!(await transferWorkflowAvailable(admin))) return NextResponse.json({ error: t('transfer_draft_unavailable') }, { status: 503 })
    const { data: tr } = await admin.from('stock_transfers').select('id, reference, status, source_shop_id, destination_shop_id').eq('id', params.id).maybeSingle()
    if (!tr) return NextResponse.json({ error: t('transfer_not_found') }, { status: 404 })
    let allowed = false
    for (const shop of [tr.source_shop_id, tr.destination_shop_id]) {
      const role = await checkShopRole(supabase, user.id, shop)
      if (role && await canViewFeature(supabase, role, shop, 'transfers')) { allowed = true; break }
    }
    if (!allowed) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    if (tr.status !== 'sent') return NextResponse.json({ error: t('transfer_not_in_transit'), status: tr.status }, { status: 409 })
    const { data: tok } = await admin.from('stock_transfer_tokens').select('token, revoked_at').eq('transfer_id', tr.id).maybeSingle()
    if (!tok || tok.revoked_at) return NextResponse.json({ error: t('transfer_not_in_transit') }, { status: 409 })
    const url = new URL(request.url)
    const locale = ['fr', 'en', 'ha'].includes(url.searchParams.get('locale') || '') ? url.searchParams.get('locale')! : 'fr'
    const origin = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || url.origin
    return NextResponse.json({ data: { reference: tr.reference, url: transferQrUrl(origin, locale, tr.id, tok.token) } })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
