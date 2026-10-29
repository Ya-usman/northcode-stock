import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { getApiTranslator } from '@/lib/api/i18n'
import { isUuid, loadNames, parseTransferCode, sameToken, transferWorkflowAvailable } from '@/lib/api/transfers'

// POST /api/stock-transfers/scan — vérifie un QR de transfert. Ne réceptionne JAMAIS : dit seulement si l'écran de
// réception peut s'ouvrir. Vérifie : connexion, QR bien formé, transfert existant, jeton valide et non révoqué,
// boutique active = destination, membre de la destination, droit « Transferts » en modification.
// body: { code, active_shop_id } → { result: 'ok' | 'wrong_shop' | 'already_received' | 'cancelled' | 'invalid' |
//   'forbidden', transfer?: { id, reference, source_shop_name, destination_shop_name, ... } }
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const { code, active_shop_id } = await request.json()
    const parsed = parseTransferCode(code)
    if (!parsed) return NextResponse.json({ result: 'invalid' })

    const admin = await createAdminClient() as any
    if (!(await transferWorkflowAvailable(admin))) return NextResponse.json({ result: 'invalid' })
    const [{ data: tr }, { data: tok }] = await Promise.all([
      admin.from('stock_transfers').select('id, reference, status, source_shop_id, destination_shop_id, sent_at, created_at, received_at, received_by').eq('id', parsed.transferId).maybeSingle(),
      admin.from('stock_transfer_tokens').select('token, revoked_at').eq('transfer_id', parsed.transferId).maybeSingle(),
    ])
    if (!tr || !tok || !sameToken(tok.token, parsed.token)) return NextResponse.json({ result: 'invalid' })

    const { data: shops } = await admin.from('shops').select('id, name').in('id', [tr.source_shop_id, tr.destination_shop_id])
    const shopName = Object.fromEntries(((shops || []) as any[]).map(s => [s.id, s.name]))
    const summary = { id: tr.id, reference: tr.reference, status: tr.status, source_shop_name: shopName[tr.source_shop_id] ?? null, destination_shop_name: shopName[tr.destination_shop_id] ?? null, sent_at: tr.sent_at ?? tr.created_at }

    // Membre et droit à la destination (relue en base), puis boutique active
    const role = await checkShopRole(supabase, user.id, tr.destination_shop_id)
    if (!role || !(await canWriteFeature(supabase, role, tr.destination_shop_id, 'transfers'))) {
      if (role) return NextResponse.json({ result: 'forbidden', transfer: { reference: tr.reference } })
      // Pas membre de la destination : le nom de la bonne boutique n'est donné qu'à un membre de la MÊME entreprise
      // (« Ce transfert est destiné à … ») ; à quiconque d'autre, rien
      const { data: dest } = await admin.from('shops').select('entity_id').eq('id', tr.destination_shop_id).maybeSingle()
      const { data: mine } = await admin.from('shop_members').select('shops!inner(entity_id)').eq('user_id', user.id).eq('is_active', true)
      const sameCompany = !!dest?.entity_id && ((mine || []) as any[]).some(m => m.shops?.entity_id === dest.entity_id)
      return sameCompany
        ? NextResponse.json({ result: 'wrong_shop', transfer: { reference: tr.reference, destination_shop_name: summary.destination_shop_name } })
        : NextResponse.json({ result: 'forbidden' })
    }
    if (tr.status === 'received') {
      const names = await loadNames(admin, [tr.received_by])
      return NextResponse.json({ result: 'already_received', transfer: { ...summary, received_at: tr.received_at, received_by_name: names[tr.received_by] || null } })
    }
    if (tr.status === 'cancelled' || tok.revoked_at) return NextResponse.json({ result: 'cancelled', transfer: summary })
    if (tr.status !== 'sent') return NextResponse.json({ result: 'invalid' })
    if (isUuid(active_shop_id) && active_shop_id !== tr.destination_shop_id) {
      return NextResponse.json({ result: 'wrong_shop', transfer: { ...summary, destination_shop_id: tr.destination_shop_id } })
    }
    return NextResponse.json({ result: 'ok', transfer: { ...summary, destination_shop_id: tr.destination_shop_id } })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
