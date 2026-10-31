import { NextResponse } from 'next/server'
import { shopShortLabels } from '@/lib/shops/short-name-server'
import { canViewCost, canViewFeature, canWriteFeature } from '@/lib/api/role-permissions'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'
import { notifyRequester } from '@/lib/api/transfer-requests'
import { loadNames, transferError, transferWorkflowAvailable } from '@/lib/api/transfers'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/stock-transfers?shop_ids=a,b (ou shop_id=) — transferts dont une de ces boutiques est la source OU la
// destination. Seules comptent les boutiques où la personne a le droit « Transferts » en LECTURE (boutique par
// boutique). Chaque transfert porte : noms des boutiques et des personnes, totaux (lignes, unités envoyées / reçues,
// manquants), et ce que la personne peut y faire (réceptionner à la destination, envoyer / annuler à la source).
// Prix d'achat des lignes : seulement avec le droit de voir les coûts dans la source ou la destination.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const requested = (searchParams.get('shop_ids') ?? searchParams.get('shop_id') ?? '').split(',').map(x => x.trim()).filter(x => UUID.test(x))
    if (!requested.length) return NextResponse.json({ error: t('shop_id_required') }, { status: 400 })
    const allowed: string[] = []
    const costShops = new Set<string>()
    const writeShops = new Set<string>()
    for (const id of Array.from(new Set(requested))) {
      const role = await checkShopRole(supabase, user.id, id)
      if (!role || !(await canViewFeature(supabase, role, id, 'transfers'))) continue
      allowed.push(id)
      if (await canViewCost(supabase, role, id)) costShops.add(id)
      if (await canWriteFeature(supabase, role, id, 'transfers')) writeShops.add(id)
    }
    if (!allowed.length) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    const inList = allowed.join(',')

    const admin = await createAdminClient() as any
    let query = admin
      .from('stock_transfers')
      .select('*, stock_transfer_items(*)')
      .or(`source_shop_id.in.(${inList}),destination_shop_id.in.(${inList})`)
      .order('created_at', { ascending: false })
    const reference = searchParams.get('reference')
    if (reference) query = query.ilike('reference', reference.trim())
    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // Deux liens vers shops (source / destination) : résolus à part plutôt que par un embed ambigu
    const shopIds = Array.from(new Set((data || []).flatMap((x: any) => [x.source_shop_id, x.destination_shop_id])))
    const { data: shops } = shopIds.length ? await admin.from('shops').select('id, name').in('id', shopIds) : { data: [] as any[] }
    const shopName: Record<string, string> = Object.fromEntries(((shops || []) as any[]).map(s => [s.id, s.name]))
    const names = await loadNames(admin, (data || []).flatMap((x: any) => [x.created_by, x.sent_by, x.received_by, x.cancelled_by]))
    const workflow = await transferWorkflowAvailable(admin)

    const out = (data || []).map((x: any) => {
      const showCost = costShops.has(x.source_shop_id) || costShops.has(x.destination_shop_id)
      const items = ((x.stock_transfer_items || []) as any[]).map(({ buying_price, ...line }) => (showCost ? { ...line, buying_price } : line))
      const unitsSent = items.reduce((n, it) => n + (Number(it.quantity_sent) || 0), 0)
      const unitsReceived = x.status === 'received' ? items.reduce((n, it) => n + (Number(it.quantity_received) || 0), 0) : null
      return {
        ...x,
        sent_at: x.sent_at ?? (x.status !== 'draft' ? x.created_at : null),
        stock_transfer_items: items,
        source_shop_name: shopName[x.source_shop_id] || null,
        destination_shop_name: shopName[x.destination_shop_id] || null,
        created_by_name: names[x.created_by] || null,
        sent_by_name: names[x.sent_by ?? x.created_by] || null,
        received_by_name: names[x.received_by] || null,
        cancelled_by_name: names[x.cancelled_by] || null,
        lines: items.length,
        units_sent: unitsSent,
        units_received: unitsReceived,
        units_missing: unitsReceived == null ? 0 : Math.max(0, unitsSent - unitsReceived),
        // Ce que la personne peut faire (le serveur revérifie à chaque action)
        can_receive: x.status === 'sent' && writeShops.has(x.destination_shop_id),
        can_manage_source: writeShops.has(x.source_shop_id),
      }
    })
    return NextResponse.json({ data: out, workflow })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/stock-transfers — crée un transfert : envoyé tout de suite (par défaut) ou gardé en BROUILLON
// (send: false, migration 188 : aucun stock touché). Droit « Transferts » en modification dans la boutique SOURCE.
// body: { source_shop_id, destination_shop_id, notes?, items: [{product_id, quantity}], send?: boolean, request_id? }
// request_id (migration 190) : transfert créé en ACCEPTANT une demande ; elle doit être en attente et viser exactement
// ces deux boutiques ; elle passe à « acceptée » et pointe vers le transfert, la personne qui a demandé est prévenue.
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { source_shop_id, destination_shop_id, notes, items, send, request_id } = await request.json()
    if (!UUID.test(String(source_shop_id || '')) || !UUID.test(String(destination_shop_id || '')))
      return NextResponse.json({ error: t('source_destination_required') }, { status: 400 })
    if (!Array.isArray(items) || items.length === 0)
      return NextResponse.json({ error: t('at_least_one_product_required') }, { status: 400 })
    const cleanItems = items.map((it: any) => ({ product_id: String(it?.product_id || ''), quantity: Math.floor(Number(it?.quantity) || 0) }))
    if (cleanItems.some(it => !UUID.test(it.product_id) || it.quantity <= 0))
      return NextResponse.json({ error: t('transfer_invalid_quantity', { product: '', max: 0 }) }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, source_shop_id)
    if (!role || !(await canWriteFeature(supabase, role, source_shop_id, 'transfers')))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any
    let linked: any = null
    if (request_id != null) {
      if (!UUID.test(String(request_id))) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
      const { data: req } = await admin.from('stock_transfer_requests').select('*').eq('id', request_id).maybeSingle()
      if (!req) return NextResponse.json({ error: t('transfer_request_not_found') }, { status: 404 })
      if (req.status !== 'pending') return NextResponse.json({ error: t('transfer_request_already_decided'), code: 'not_pending' }, { status: 409 })
      if (req.source_shop_id !== source_shop_id || req.requesting_shop_id !== destination_shop_id)
        return NextResponse.json({ error: t('transfer_request_mismatch') }, { status: 400 })
      linked = req
    }
    const workflow = await transferWorkflowAvailable(admin)
    const asDraft = send === false
    if (asDraft && !workflow) return NextResponse.json({ error: t('transfer_draft_unavailable') }, { status: 503 })
    const { data, error } = workflow
      ? await admin.rpc('create_stock_transfer', {
          p_source: source_shop_id, p_dest: destination_shop_id, p_user: user.id, p_notes: notes || null, p_items: cleanItems, p_send: !asDraft,
        })
      : await admin.rpc('send_stock_transfer', {
          p_source_shop_id: source_shop_id, p_destination_shop_id: destination_shop_id, p_performed_by: user.id, p_notes: notes || null, p_items: cleanItems,
        })
    if (error) {
      const e = transferError(error)
      return NextResponse.json({ error: e ? t(e.key as any, e.params as any) : error.message, code: e?.key }, { status: 400 })
    }

    // Après la 188, le journal est écrit par la base dans la même transaction ; avant, par la route
    if (!workflow) {
      const { data: actorProfile } = await admin.from('profiles').select('full_name').eq('id', user.id).single()
      await writeAuditLog({
        action: 'stock_transfer.send', shop_id: source_shop_id, actor_id: user.id, actor_email: user.email,
        target_id: data?.id, target_type: 'stock_transfer', ip: getClientIp(request),
        metadata: { actor_name: actorProfile?.full_name || user.email, reference: data?.reference, destination_shop_id },
      })
    }
    // Demande acceptée : rattachée au transfert créé (écriture conditionnée : encore en attente)
    if (linked && data?.id) {
      const now = new Date().toISOString()
      await admin.from('stock_transfer_requests')
        .update({ status: 'accepted', transfer_id: data.id, decided_by: user.id, decided_at: now, updated_at: now })
        .eq('id', linked.id).eq('status', 'pending')
      await writeAuditLog({
        action: 'stock_transfer.request_accept', shop_id: source_shop_id, actor_id: user.id, actor_email: user.email,
        target_id: linked.id, target_type: 'stock_transfer_request', ip: getClientIp(request),
        metadata: { product_name: linked.product_name, quantity: linked.quantity, reference: data?.reference, transfer_id: data.id },
      })
      const { data: src } = await admin.from('shops').select('name').eq('id', source_shop_id).maybeSingle()
      await notifyRequester(admin, linked.requesting_shop_id, linked.requested_by, {
        title: t('push_transfer_request_accepted_title', { shop: (await shopShortLabels(admin, [source_shop_id]))[source_shop_id] || src?.name || '' }),
        body: asDraft ? t('push_transfer_request_prepared_body', { reference: data?.reference ?? '' }) : t('push_transfer_request_sent_body', { reference: data?.reference ?? '' }),
      })
    }
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
