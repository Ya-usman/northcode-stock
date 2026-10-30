import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/api/shop-auth'
import { getApiTranslator } from '@/lib/api/i18n'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { loadElsewhere, transferRequestsAvailable } from '@/lib/stock/elsewhere-load'
import { REQUEST_NOTE_MAX, canDecideFor, canRequestFor, canSeeRequests, memberRole, notifyNewRequest, sameEntity } from '@/lib/api/transfer-requests'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RECENT_DAYS = 14

// GET /api/stock-transfers/requests?shop_ids=a,b
// Demandes REÇUES (boutiques où la personne voit les Transferts : à traiter) et ENVOYÉES (boutiques où elle vend ou
// gère les transferts : en attente + décidées ces 14 derniers jours). `available` = migration 190 appliquée.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const shopIds = Array.from(new Set((new URL(request.url).searchParams.get('shop_ids') || '').split(',').map(s => s.trim()).filter(s => UUID.test(s))))
    if (!shopIds.length) return NextResponse.json({ error: t('shop_ids_required') }, { status: 400 })
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const admin = await createAdminClient() as any
    if (!(await transferRequestsAvailable(admin))) return NextResponse.json({ available: false, incoming: [], outgoing: [] })

    const incomingShops: string[] = [], outgoingShops: string[] = [], decideShops = new Set<string>(), cancelShops = new Set<string>()
    await Promise.all(shopIds.map(async id => {
      const role = await memberRole(supabase, user.id, id)
      const see = await canSeeRequests(supabase, role, id)
      if (see.incoming) incomingShops.push(id)
      if (see.outgoing) outgoingShops.push(id)
      if (await canDecideFor(supabase, role, id)) decideShops.add(id)
      if (await canRequestFor(supabase, admin, role, id)) cancelShops.add(id)
    }))
    const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString()
    const cols = 'id, requesting_shop_id, source_shop_id, source_product_id, destination_product_id, product_name, quantity, note, status, decline_reason, transfer_id, requested_by, decided_by, created_at, decided_at'
    const [inc, out] = await Promise.all([
      incomingShops.length
        ? admin.from('stock_transfer_requests').select(cols).in('source_shop_id', incomingShops).eq('status', 'pending').order('created_at', { ascending: false }).limit(200)
        : Promise.resolve({ data: [] }),
      outgoingShops.length
        ? admin.from('stock_transfer_requests').select(cols).in('requesting_shop_id', outgoingShops).or(`status.eq.pending,decided_at.gte.${since}`).order('created_at', { ascending: false }).limit(200)
        : Promise.resolve({ data: [] }),
    ])
    const rows = [...(inc.data || []), ...(out.data || [])] as any[]
    const shopNames: Record<string, string> = {}, people: Record<string, string> = {}, refs: Record<string, string> = {}, units: Record<string, string | null> = {}
    const sIds = Array.from(new Set(rows.flatMap(r => [r.requesting_shop_id, r.source_shop_id])))
    const pIds = Array.from(new Set(rows.flatMap(r => [r.requested_by, r.decided_by]).filter(Boolean)))
    const tIds = Array.from(new Set(rows.map(r => r.transfer_id).filter(Boolean)))
    const prodIds = Array.from(new Set(rows.map(r => r.source_product_id)))
    await Promise.all([
      sIds.length ? admin.from('shops').select('id, name').in('id', sIds).then((r: any) => { for (const s of r.data || []) shopNames[s.id] = s.name }) : null,
      pIds.length ? admin.from('profiles').select('id, full_name').in('id', pIds).then((r: any) => { for (const p of r.data || []) people[p.id] = p.full_name }) : null,
      tIds.length ? admin.from('stock_transfers').select('id, reference').in('id', tIds).then((r: any) => { for (const x of r.data || []) refs[x.id] = x.reference }) : null,
      prodIds.length ? admin.from('products').select('id, unit').in('id', prodIds).then((r: any) => { for (const x of r.data || []) units[x.id] = x.unit ?? null }) : null,
    ])
    const view = (r: any) => ({
      ...r,
      requesting_shop_name: shopNames[r.requesting_shop_id] ?? null, source_shop_name: shopNames[r.source_shop_id] ?? null,
      requested_by_name: r.requested_by ? people[r.requested_by] ?? null : null, decided_by_name: r.decided_by ? people[r.decided_by] ?? null : null,
      transfer_reference: r.transfer_id ? refs[r.transfer_id] ?? null : null, unit: units[r.source_product_id] ?? null,
      can_decide: r.status === 'pending' && decideShops.has(r.source_shop_id),
      can_cancel: r.status === 'pending' && cancelShops.has(r.requesting_shop_id),
    })
    return NextResponse.json({ available: true, incoming: (inc.data || []).map(view), outgoing: (out.data || []).map(view) })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/stock-transfers/requests — { shop_id (boutique qui demande), product_id (son produit), source_shop_id, quantity, note? }
// La correspondance du produit et la quantité disponible sont recalculées par le serveur (jamais celles du navigateur).
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const body = await request.json().catch(() => ({}))
    const shopId = String(body.shop_id || ''), productId = String(body.product_id || ''), sourceShopId = String(body.source_shop_id || '')
    const quantity = Math.floor(Number(body.quantity) || 0)
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, REQUEST_NOTE_MAX) : ''
    if (![shopId, productId, sourceShopId].every(x => UUID.test(x)) || shopId === sourceShopId || quantity <= 0)
      return NextResponse.json({ error: t('invalid_data') }, { status: 400 })

    const admin = await createAdminClient() as any
    if (!(await transferRequestsAvailable(admin))) return NextResponse.json({ error: t('transfer_request_unavailable') }, { status: 503 })
    const role = await memberRole(supabase, user.id, shopId)
    if (!(await canRequestFor(supabase, admin, role, shopId))) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    if (!(await sameEntity(admin, shopId, sourceShopId))) return NextResponse.json({ error: t('transfer_other_company') }, { status: 400 })

    const { items } = await loadElsewhere(admin, shopId, [productId])
    const offer = items[productId]?.shops.find(s => s.shop_id === sourceShopId)
    if (!offer) return NextResponse.json({ error: t('transfer_request_not_available') }, { status: 400 })
    if (quantity > offer.available) return NextResponse.json({ error: t('transfer_request_too_many', { max: offer.available }), max: offer.available }, { status: 400 })
    const { data: product } = await admin.from('products').select('id, name').eq('id', productId).eq('shop_id', shopId).maybeSingle()
    if (!product) return NextResponse.json({ error: t('product_not_found') }, { status: 404 })

    const { data, error } = await admin.from('stock_transfer_requests').insert({
      requesting_shop_id: shopId, source_shop_id: sourceShopId, source_product_id: offer.source_product_id, destination_product_id: productId,
      product_name: product.name, quantity, note: note || null, requested_by: user.id,
    }).select('id').single()
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: t('transfer_request_already_pending'), code: 'already_pending' }, { status: 409 })
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    const { data: shops } = await admin.from('shops').select('id, name').in('id', [shopId, sourceShopId])
    const nameOf = (id: string) => (shops || []).find((s: any) => s.id === id)?.name ?? ''
    await writeAuditLog({
      action: 'stock_transfer.request', shop_id: shopId, actor_id: user.id, actor_email: user.email, target_id: data.id,
      target_type: 'stock_transfer_request', ip: getClientIp(request),
      metadata: { product_name: product.name, quantity, source_shop_id: sourceShopId, source_shop_name: nameOf(sourceShopId) },
    })
    await notifyNewRequest(admin, sourceShopId, {
      title: t('push_transfer_request_title', { shop: nameOf(shopId) }),
      body: t('push_transfer_request_body', { quantity, product: product.name }),
    })
    return NextResponse.json({ data: { id: data.id } })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
