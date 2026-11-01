import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canViewFeature, canWriteFeature } from '@/lib/api/role-permissions'
import { getApiTranslator } from '@/lib/api/i18n'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { cleanSerials, serialErrorResponse, serialsBySaleItem } from '@/lib/api/serials'

// Numéros de série (étape 11 du Stock, migrations 197 / 198, 1er nov. 2026) — registre réservé au serveur.
// GET  ?shop_id=&product_id=[&status=]  numéros d'un produit : droit Stock (liste complète, vente rattachée) ; caisse
//                                       (droit Nouvelle vente) : numéros EN STOCK seulement, pour les choisir
// GET  ?shop_ids=&q=                    recherche d'un numéro dans les boutiques où l'on a le droit Stock
// GET  ?shop_id=&serial=                caisse : ce numéro scanné est-il EN STOCK ? → { product_id, serial } ou null
// GET  ?sale_id=                        numéros vendus d'une vente, par ligne (Historique ou Caisse de SA boutique)
// POST { shop_id, product_id, serials } numéroter le stock déjà présent (add_existing_serials) — Stock en modification
// PATCH { shop_id, id, serial }          corriger un numéro mal saisi (en stock) — Stock en modification
// PATCH { shop_id, id, action: 'remove', reason } retirer un numéro EN TROP (plus de numéros en stock que d'unités,
//                                       ex. après un inventaire en manque) — Stock en modification ; jamais supprimé
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function saleInfo(admin: any, rows: any[]) {
  const itemIds = Array.from(new Set(rows.map(r => r.sale_item_id).filter(Boolean)))
  if (!itemIds.length) return {}
  const { data } = await admin.from('sale_items').select('id, sale_id, sales(sale_number, created_at, sale_status, customers(name))').in('id', itemIds)
  return Object.fromEntries((data || []).map((x: any) => [x.id, {
    sale_id: x.sale_id, sale_number: x.sales?.sale_number ?? null, sale_status: x.sales?.sale_status ?? null,
    customer_name: x.sales?.customers?.name ?? null,
  }]))
}

export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const p = new URL(request.url).searchParams
    const admin = await createAdminClient() as any

    // Recherche d'un numéro
    const q = (p.get('q') || '').trim()
    if (q) {
      if (q.length < 3 || q.length > 64) return NextResponse.json({ data: [] })
      const requested = (p.get('shop_ids') || p.get('shop_id') || '').split(',').map(x => x.trim()).filter(x => UUID.test(x))
      const shops: string[] = []
      for (const id of Array.from(new Set(requested))) {
        const role = await checkShopRole(supabase, user.id, id)
        if (role && await canViewFeature(supabase, role, id, 'stock')) shops.push(id)
      }
      if (!shops.length) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
      const like = q.replace(/[%_\\]/g, m => '\\' + m)
      const { data, error } = await admin.from('product_serials')
        .select('id, shop_id, product_id, serial, status, received_at, sold_at, sale_item_id, products(name)')
        .in('shop_id', shops).ilike('serial', `%${like}%`).order('serial').limit(20)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      const sales = await saleInfo(admin, data || [])
      return NextResponse.json({ data: (data || []).map((r: any) => ({ ...r, product_name: r.products?.name ?? null, products: undefined, sale: sales[r.sale_item_id] ?? null })) })
    }

    // Numéros d'une vente : boutique relue en base, droit Historique des ventes (lecture) ou Nouvelle vente
    const saleId = p.get('sale_id')
    if (saleId) {
      if (!UUID.test(saleId)) return NextResponse.json({ data: {} })
      const { data: sale } = await admin.from('sales').select('shop_id').eq('id', saleId).maybeSingle()
      if (!sale) return NextResponse.json({ data: {} })
      const role = await checkShopRole(supabase, user.id, sale.shop_id)
      const allowed = role && ((await canViewFeature(supabase, role, sale.shop_id, 'sales_history')) || (await canWriteFeature(supabase, role, sale.shop_id, 'new_sale', { ignoreHours: true })))
      if (!allowed) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
      const { data: lines } = await admin.from('sale_items').select('id').eq('sale_id', saleId)
      return NextResponse.json({ data: await serialsBySaleItem(admin, (lines || []).map((l: any) => l.id)) })
    }

    // Caisse : numéro scanné (exact, casse ignorée), en stock dans la boutique — droit Stock ou Nouvelle vente
    const scanned = (p.get('serial') || '').trim()
    if (scanned) {
      const sid = p.get('shop_id')
      if (!sid || !UUID.test(sid) || scanned.length > 64) return NextResponse.json({ data: null })
      const role = await checkShopRole(supabase, user.id, sid)
      const allowed = role && ((await canViewFeature(supabase, role, sid, 'stock')) || (await canWriteFeature(supabase, role, sid, 'new_sale', { ignoreHours: true })))
      if (!allowed) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
      const like = scanned.replace(/[%_\\]/g, m => '\\' + m)
      const { data } = await admin.from('product_serials').select('product_id, serial').eq('shop_id', sid).eq('status', 'in_stock').ilike('serial', like).limit(1)
      return NextResponse.json({ data: data?.[0] ?? null })
    }

    const shopId = p.get('shop_id'), productId = p.get('product_id')
    if (!shopId || !UUID.test(shopId) || !productId || !UUID.test(productId)) return NextResponse.json({ error: t('shop_id_required') }, { status: 400 })
    const role = await checkShopRole(supabase, user.id, shopId)
    if (!role) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    const stockView = await canViewFeature(supabase, role, shopId, 'stock')
    const posOnly = !stockView && await canWriteFeature(supabase, role, shopId, 'new_sale', { ignoreHours: true })
    if (!stockView && !posOnly) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    let query = admin.from('product_serials').select('id, serial, status, received_at, sold_at, sale_item_id, source')
      .eq('shop_id', shopId).eq('product_id', productId).order('received_at', { ascending: false }).limit(1000)
    const status = p.get('status')
    if (posOnly) query = query.eq('status', 'in_stock')
    else if (status && ['in_stock', 'sold', 'in_transit', 'removed'].includes(status)) query = query.eq('status', status)
    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (posOnly) return NextResponse.json({ data: (data || []).map((r: any) => ({ id: r.id, serial: r.serial, status: r.status })) })
    const sales = await saleInfo(admin, data || [])
    return NextResponse.json({ data: (data || []).map((r: any) => ({ ...r, sale: sales[r.sale_item_id] ?? null })) })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

async function writeAccess(t: any, shopId: unknown) {
  const { user, supabase } = await getAuthedUser()
  if (!user) return { response: NextResponse.json({ error: t('not_authenticated') }, { status: 401 }) }
  if (typeof shopId !== 'string' || !UUID.test(shopId)) return { response: NextResponse.json({ error: t('shop_id_required') }, { status: 400 }) }
  const role = await checkShopRole(supabase, user.id, shopId)
  if (!role || !(await canWriteFeature(supabase, role, shopId, 'stock'))) return { response: NextResponse.json({ error: t('permission_denied') }, { status: 403 }) }
  return { user, admin: await createAdminClient() as any }
}

export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const body = await request.json()
    const a = await writeAccess(t, body.shop_id)
    if ('response' in a) return a.response
    const serials = cleanSerials(body.serials)
    if (!serials || !serials.length || typeof body.product_id !== 'string' || !UUID.test(body.product_id)) return NextResponse.json({ error: t('serial_invalid', { serial: '' }) }, { status: 400 })
    const { data, error } = await a.admin.rpc('add_existing_serials', { p_shop: body.shop_id, p_product: body.product_id, p_user: a.user.id, p_serials: serials })
    if (error) {
      const se = serialErrorResponse(error, t)
      return se ? NextResponse.json(se.body, { status: se.status }) : NextResponse.json({ error: error.message }, { status: 400 })
    }
    await writeAuditLog({ action: 'serial.add', shop_id: body.shop_id, actor_id: a.user.id, actor_email: a.user.email, target_id: body.product_id, target_type: 'product',
      metadata: { count: serials.length, serials: serials.slice(0, 50) }, ip: getClientIp(request) })
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const t = getApiTranslator(request)
  try {
    const body = await request.json()
    const a = await writeAccess(t, body.shop_id)
    if ('response' in a) return a.response
    if (body.action === 'remove') {
      if (typeof body.id !== 'string' || !UUID.test(body.id)) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
      const reason = String(body.reason ?? '').trim().slice(0, 200) || null
      const { data: row } = await a.admin.from('product_serials').select('id, serial, product_id, status').eq('id', body.id).eq('shop_id', body.shop_id).maybeSingle()
      if (!row || row.status !== 'in_stock') return NextResponse.json({ error: t('serial_not_in_stock', { serial: row?.serial ?? '' }), code: 'serial_not_in_stock' }, { status: 400 })
      const { data: prod } = await a.admin.from('products').select('quantity').eq('id', row.product_id).single()
      const { count } = await a.admin.from('product_serials').select('id', { count: 'exact', head: true }).eq('product_id', row.product_id).eq('status', 'in_stock')
      // Retrait permis seulement quand le registre dépasse le stock réel (le registre ne descend jamais sous le stock)
      if ((count || 0) <= Math.max(0, Number(prod?.quantity) || 0)) return NextResponse.json({ error: t('serial_remove_not_surplus'), code: 'serial_remove_not_surplus' }, { status: 400 })
      const { error } = await a.admin.from('product_serials').update({ status: 'removed', removed_reason: reason, updated_at: new Date().toISOString() })
        .eq('id', row.id).eq('status', 'in_stock')
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      await writeAuditLog({ action: 'serial.remove', shop_id: body.shop_id, actor_id: a.user.id, actor_email: a.user.email, target_id: row.id, target_type: 'product_serial',
        metadata: { serial: row.serial, product_id: row.product_id, reason }, ip: getClientIp(request) })
      return NextResponse.json({ data: { removed: row.serial } })
    }
    const next = cleanSerials([body.serial])
    if (!next || next.length !== 1 || typeof body.id !== 'string' || !UUID.test(body.id)) return NextResponse.json({ error: t('serial_invalid', { serial: String(body.serial ?? '') }) }, { status: 400 })
    const { data, error } = await a.admin.rpc('correct_product_serial', { p_shop: body.shop_id, p_serial_id: body.id, p_new: next[0], p_user: a.user.id })
    if (error) {
      const se = serialErrorResponse(error, t)
      return se ? NextResponse.json(se.body, { status: se.status }) : NextResponse.json({ error: error.message }, { status: 400 })
    }
    await writeAuditLog({ action: 'serial.correct', shop_id: body.shop_id, actor_id: a.user.id, actor_email: a.user.email, target_id: body.id, target_type: 'product_serial',
      metadata: data, ip: getClientIp(request) })
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
