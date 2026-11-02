import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canViewFeature, canWriteFeature } from '@/lib/api/role-permissions'
import { getApiTranslator } from '@/lib/api/i18n'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { classifyBarcode } from '@/lib/products/barcode'
import { validPackInput } from '@/lib/products/packaging'

// Conditionnements d'achat d'un produit (étape 9 du Stock, migration 195, 1er nov. 2026) — table réservée au serveur.
// GET    ?shop_id=&product_id=   (product_id facultatif : tous ceux de la boutique) — droit Stock en consultation
// GET    ?shop_id=&barcode=      (caisse : ce code est-il celui d'un colis ?) — tout membre de la boutique, une ligne au plus
// POST   { shop_id, product_id, unit, units_per_pack, barcode?, is_default? }          — Stock en modification
// PATCH  { shop_id, id, unit?, units_per_pack?, barcode?, is_default? }                — Stock en modification
// DELETE ?shop_id=&id=                                                                 — Stock en modification
// Code-barres du colis : même règle que celui des produits (classifyBarcode : GTIN au chiffre de contrôle juste, ou
// référence maison), jamais le code d'un produit de la boutique (le scan en caisse doit rester sans ambiguïté).
const COLUMNS = 'id, product_id, unit, units_per_pack, barcode, is_default'

async function access(t: any, shopId: unknown, mode: 'member' | 'view' | 'write') {
  const { user, supabase } = await getAuthedUser()
  if (!user) return { response: NextResponse.json({ error: t('not_authenticated') }, { status: 401 }) }
  if (typeof shopId !== 'string' || !shopId) return { response: NextResponse.json({ error: t('shop_id_required') }, { status: 400 }) }
  const role = await checkShopRole(supabase, user.id, shopId)
  const allowed = role && (mode === 'member' ? true : mode === 'view' ? await canViewFeature(supabase, role, shopId, 'stock') : await canWriteFeature(supabase, role, shopId, 'stock'))
  if (!allowed) return { response: NextResponse.json({ error: t('permission_denied') }, { status: 403 }) }
  return { user, admin: await createAdminClient() as any }
}

async function barcodeProblem(admin: any, t: any, shopId: string, barcode: string | null, exceptId?: string): Promise<NextResponse | null> {
  if (!barcode) return null
  if (classifyBarcode(barcode) === 'gtin_invalid') return NextResponse.json({ error: t('barcode_invalid'), field: 'barcode' }, { status: 400 })
  const [{ data: prod }, { data: pack }] = await Promise.all([
    admin.from('products').select('id').eq('shop_id', shopId).eq('sku', barcode).limit(1),
    admin.from('product_packagings').select('id').eq('shop_id', shopId).eq('barcode', barcode).neq('id', exceptId ?? '00000000-0000-0000-0000-000000000000').limit(1),
  ])
  if ((prod || []).length || (pack || []).length) return NextResponse.json({ error: t('packaging_barcode_taken'), field: 'barcode' }, { status: 409 })
  return null
}

export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const p = new URL(request.url).searchParams
    const barcode = (p.get('barcode') || '').trim()
    // Caisse (?pos=1) : tout membre, colonnes utiles à la vente seulement (bouton « + 1 carton »)
    const pos = p.get('pos') === '1'
    const a = await access(t, p.get('shop_id'), barcode || pos ? 'member' : 'view')
    if ('response' in a) return a.response
    if (barcode) {
      // Caisse : un colis scanné ne s'ajoute pas au panier, on dit lequel c'est (produit, colis) sans rien d'autre
      const { data: k } = await a.admin.from('product_packagings').select('product_id, unit, units_per_pack, products(name, unit)').eq('shop_id', p.get('shop_id')).eq('barcode', barcode).maybeSingle()
      return NextResponse.json({ data: k ? { product_id: k.product_id, name: k.products?.name ?? '', base_unit: k.products?.unit ?? null, unit: k.unit, units_per_pack: k.units_per_pack } : null })
    }
    let q = a.admin.from('product_packagings').select(pos ? 'product_id, unit, units_per_pack, is_default' : COLUMNS).eq('shop_id', p.get('shop_id')).order('units_per_pack')
    if (p.get('product_id')) q = q.eq('product_id', p.get('product_id'))
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ data: data || [] })
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
    const bad = validPackInput(body.unit, body.units_per_pack)
    if (bad) return NextResponse.json({ error: t(bad as any) }, { status: 400 })
    const { data: product } = await a.admin.from('products').select('id, name').eq('id', body.product_id).eq('shop_id', body.shop_id).maybeSingle()
    if (!product) return NextResponse.json({ error: t('product_not_found') }, { status: 404 })
    const barcode = typeof body.barcode === 'string' && body.barcode.trim() ? body.barcode.trim() : null
    const bc = await barcodeProblem(a.admin, t, body.shop_id, barcode)
    if (bc) return bc
    const isDefault = !!body.is_default
    if (isDefault) await a.admin.from('product_packagings').update({ is_default: false, updated_at: new Date().toISOString() }).eq('product_id', product.id).eq('is_default', true)
    const { data, error } = await a.admin.from('product_packagings').insert({
      shop_id: body.shop_id, product_id: product.id, unit: String(body.unit).trim(), units_per_pack: Number(body.units_per_pack),
      barcode, is_default: isDefault, created_by: a.user.id,
    }).select(COLUMNS).single()
    if (error) return NextResponse.json({ error: error.code === '23505' ? t('packaging_duplicate') : error.message }, { status: error.code === '23505' ? 409 : 400 })
    await writeAuditLog({ action: 'packaging.create', shop_id: body.shop_id, actor_id: a.user.id, actor_email: a.user.email, target_id: product.id, target_type: 'product', ip: getClientIp(request),
      metadata: { product_name: product.name, unit: data.unit, units_per_pack: data.units_per_pack } })
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const t = getApiTranslator(request)
  try {
    const body = await request.json()
    const a = await access(t, body.shop_id, 'write')
    if ('response' in a) return a.response
    const { data: cur } = await a.admin.from('product_packagings').select(COLUMNS).eq('id', body.id).eq('shop_id', body.shop_id).maybeSingle()
    if (!cur) return NextResponse.json({ error: t('packaging_not_found') }, { status: 404 })
    const unit = 'unit' in body ? body.unit : cur.unit
    const units = 'units_per_pack' in body ? body.units_per_pack : cur.units_per_pack
    const bad = validPackInput(unit, units)
    if (bad) return NextResponse.json({ error: t(bad as any) }, { status: 400 })
    const barcode = 'barcode' in body ? (typeof body.barcode === 'string' && body.barcode.trim() ? body.barcode.trim() : null) : cur.barcode
    if (barcode !== cur.barcode) { const bc = await barcodeProblem(a.admin, t, body.shop_id, barcode, cur.id); if (bc) return bc }
    const isDefault = 'is_default' in body ? !!body.is_default : cur.is_default
    if (isDefault && !cur.is_default) await a.admin.from('product_packagings').update({ is_default: false, updated_at: new Date().toISOString() }).eq('product_id', cur.product_id).eq('is_default', true)
    const { data, error } = await a.admin.from('product_packagings').update({ unit: String(unit).trim(), units_per_pack: Number(units), barcode, is_default: isDefault, updated_at: new Date().toISOString() })
      .eq('id', cur.id).eq('shop_id', body.shop_id).select(COLUMNS).single()
    if (error) return NextResponse.json({ error: error.code === '23505' ? t('packaging_duplicate') : error.message }, { status: error.code === '23505' ? 409 : 400 })
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const t = getApiTranslator(request)
  try {
    const p = new URL(request.url).searchParams
    const a = await access(t, p.get('shop_id'), 'write')
    if ('response' in a) return a.response
    // Les bons de commande gardent leur copie figée (pack_unit, units_per_pack) : supprimer le conditionnement ne change rien à l'historique
    const { data, error } = await a.admin.from('product_packagings').delete().eq('id', p.get('id')).eq('shop_id', p.get('shop_id')).select('id, product_id, unit, units_per_pack')
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (!data?.length) return NextResponse.json({ error: t('packaging_not_found') }, { status: 404 })
    await writeAuditLog({ action: 'packaging.delete', shop_id: p.get('shop_id'), actor_id: a.user.id, actor_email: a.user.email, target_id: data[0].product_id, target_type: 'product', ip: getClientIp(request),
      metadata: { unit: data[0].unit, units_per_pack: data[0].units_per_pack } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
