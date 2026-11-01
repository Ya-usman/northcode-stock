import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canViewFeature, canWriteFeature } from '@/lib/api/role-permissions'
import { getApiTranslator } from '@/lib/api/i18n'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

// Kits assemblés (étape 16 du Stock, migration 200, 1er nov. 2026) — composition réservée au serveur.
// GET  ?shop_id=&product_id=                        composition, stock vendable des composants, kits assemblables — Stock (lecture)
// PUT  { shop_id, product_id, components: [{ product_id, quantity }] }  composition (vide = plus un kit) — Stock (modification)
// POST { shop_id, product_id, action: 'assemble' | 'disassemble', quantity, notes? }        — Stock (modification)
// Règles : composants de la MÊME boutique, jamais le kit lui-même, jamais un autre kit, jamais un produit suivi par numéro
// de série (ni le kit) ; assemblage / désassemblage en une transaction (assemble_kit / disassemble_kit).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function access(t: any, shopId: unknown, mode: 'view' | 'write') {
  const { user, supabase } = await getAuthedUser()
  if (!user) return { response: NextResponse.json({ error: t('not_authenticated') }, { status: 401 }) }
  if (typeof shopId !== 'string' || !UUID.test(shopId)) return { response: NextResponse.json({ error: t('shop_id_required') }, { status: 400 }) }
  const role = await checkShopRole(supabase, user.id, shopId)
  const allowed = role && (mode === 'view' ? await canViewFeature(supabase, role, shopId, 'stock') : await canWriteFeature(supabase, role, shopId, 'stock'))
  if (!allowed) return { response: NextResponse.json({ error: t('permission_denied') }, { status: 403 }) }
  return { user, admin: await createAdminClient() as any }
}

/** Refus SQL des kits (P0090 à P0093) → message traduit */
function kitError(error: any, t: any): { status: number; body: Record<string, unknown> } | null {
  const code = String(error?.code || '')
  const raw = String(error?.details || error?.detail || '')
  if (code === 'P0091') {
    let d: any = {}; try { d = JSON.parse(raw) } catch {}
    return { status: 409, body: { error: t('kit_component_short', { product: d.product ?? '', needed: d.needed ?? 0, available: d.available ?? 0 }), code: 'kit_component_short', detail: d } }
  }
  const map: Record<string, string> = { P0090: 'kit_invalid_quantity', P0092: 'kit_invalid', P0093: 'product_not_found' }
  return map[code] ? { status: 400, body: { error: t(map[code], { product: raw }), code: map[code] } } : null
}

export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const p = new URL(request.url).searchParams
    const a = await access(t, p.get('shop_id'), 'view')
    if ('response' in a) return a.response
    const productId = p.get('product_id')
    if (!productId || !UUID.test(productId)) return NextResponse.json({ error: t('product_not_found') }, { status: 404 })
    const { data: kit } = await a.admin.from('products').select('id, is_kit').eq('id', productId).eq('shop_id', p.get('shop_id')).maybeSingle()
    if (!kit) return NextResponse.json({ error: t('product_not_found') }, { status: 404 })
    const { data: rows } = await a.admin.from('product_kit_components').select('component_product_id, quantity, products!product_kit_components_component_product_id_fkey(name, unit)').eq('kit_product_id', productId)
    // Date métier de la boutique (fuseau) : les lots périmés sont jugés comme à l'assemblage
    const { data: asOf } = await a.admin.rpc('shop_business_date', { p_shop_id: p.get('shop_id') })
    const components = []
    for (const r of (rows || []) as any[]) {
      const { data: s } = await a.admin.rpc('sellable_stock', { p_product_id: r.component_product_id, p_as_of: asOf ?? new Date().toISOString().slice(0, 10) })
      const available = Number(s?.[0]?.sellable ?? 0)
      components.push({ product_id: r.component_product_id, name: r.products?.name ?? '', unit: r.products?.unit ?? null, quantity: r.quantity, available })
    }
    const assemblable = components.length ? Math.min(...components.map(c => Math.floor(c.available / c.quantity))) : 0
    return NextResponse.json({ data: { is_kit: !!kit.is_kit, components, assemblable } })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  const t = getApiTranslator(request)
  try {
    const body = await request.json()
    const a = await access(t, body.shop_id, 'write')
    if ('response' in a) return a.response
    if (typeof body.product_id !== 'string' || !UUID.test(body.product_id) || !Array.isArray(body.components) || body.components.length > 50)
      return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    const list: { product_id: string; quantity: number }[] = body.components.map((c: any) => ({ product_id: String(c?.product_id || ''), quantity: Math.floor(Number(c?.quantity)) }))
    if (list.some(c => !UUID.test(c.product_id) || !(c.quantity >= 1 && c.quantity <= 10000)) || new Set(list.map(c => c.product_id)).size !== list.length || list.some(c => c.product_id === body.product_id))
      return NextResponse.json({ error: t('kit_components_invalid'), code: 'kit_components_invalid' }, { status: 400 })
    const ids = [body.product_id, ...list.map(c => c.product_id)]
    const { data: prods } = await a.admin.from('products').select('id, name, shop_id, is_kit, track_serials').in('id', ids)
    const byId = Object.fromEntries(((prods || []) as any[]).map(x => [x.id, x]))
    const kit = byId[body.product_id]
    if (!kit || kit.shop_id !== body.shop_id) return NextResponse.json({ error: t('product_not_found') }, { status: 404 })
    if (kit.track_serials && list.length) return NextResponse.json({ error: t('kit_invalid', { product: kit.name }), code: 'kit_invalid' }, { status: 400 })
    for (const c of list) {
      const x = byId[c.product_id]
      if (!x || x.shop_id !== body.shop_id || x.is_kit || x.track_serials)
        return NextResponse.json({ error: t('kit_component_not_allowed', { product: x?.name ?? '' }), code: 'kit_component_not_allowed' }, { status: 400 })
    }
    // Remplacement complet de la composition (jamais une ligne d'une autre boutique)
    const { error: delErr } = await a.admin.from('product_kit_components').delete().eq('kit_product_id', body.product_id).eq('shop_id', body.shop_id)
    if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 })
    if (list.length) {
      const { error: insErr } = await a.admin.from('product_kit_components').insert(list.map(c => ({ shop_id: body.shop_id, kit_product_id: body.product_id, component_product_id: c.product_id, quantity: c.quantity, created_by: a.user.id })))
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 400 })
    }
    await a.admin.from('products').update({ is_kit: list.length > 0, updated_at: new Date().toISOString() }).eq('id', body.product_id)
    await writeAuditLog({ action: 'kit.update', shop_id: body.shop_id, actor_id: a.user.id, actor_email: a.user.email, target_id: body.product_id, target_type: 'product',
      metadata: { product_name: kit.name, components: list.map(c => ({ product: byId[c.product_id]?.name, quantity: c.quantity })) }, ip: getClientIp(request) })
    return NextResponse.json({ data: { is_kit: list.length > 0, count: list.length } })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const body = await request.json()
    const a = await access(t, body.shop_id, 'write')
    if ('response' in a) return a.response
    const action = body.action === 'disassemble' ? 'disassemble' : body.action === 'assemble' ? 'assemble' : null
    const qty = Math.floor(Number(body.quantity))
    if (!action || typeof body.product_id !== 'string' || !UUID.test(body.product_id)) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 300) || null : null
    const { data, error } = await a.admin.rpc(action === 'assemble' ? 'assemble_kit' : 'disassemble_kit', { p_shop: body.shop_id, p_kit: body.product_id, p_user: a.user.id, p_qty: qty, p_notes: notes })
    if (error) {
      const k = kitError(error, t)
      return k ? NextResponse.json(k.body, { status: k.status }) : NextResponse.json({ error: error.message }, { status: 400 })
    }
    await writeAuditLog({ action: action === 'assemble' ? 'kit.assemble' : 'kit.disassemble', shop_id: body.shop_id, actor_id: a.user.id, actor_email: a.user.email,
      target_id: body.product_id, target_type: 'product', metadata: { quantity: qty, ...data, notes }, ip: getClientIp(request) })
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
