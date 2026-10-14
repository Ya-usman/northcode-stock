import { NextResponse } from 'next/server'
import { canViewCost } from '@/lib/api/role-permissions'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canWriteFeature } from '@/lib/api/role-permissions'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'
import { getApiTranslator } from '@/lib/api/i18n'

// GET /api/stock-transfers?shop_id=&reference= — liste des transferts où la
// boutique est source OU destination ; reference filtre sur un numéro précis
// (recherche "entrer le numéro du bon" côté boutique destination).
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const shopId = searchParams.get('shop_id')
    const reference = searchParams.get('reference')
    // Une boutique (shop_id) ou le contexte « Toutes les boutiques » (shop_ids) : transferts dont une de ces
    // boutiques est la source OU la destination. Seules les boutiques dont la personne est membre comptent.
    const requested = (searchParams.get('shop_ids') ?? shopId ?? '').split(',').map(x => x.trim()).filter(x => /^[0-9a-f-]{36}$/i.test(x))
    if (!requested.length) return NextResponse.json({ error: t('shop_id_required') }, { status: 400 })
    const allowed: string[] = []
    const costShops = new Set<string>() // boutiques où la personne peut voir les prix d'achat
    for (const id of Array.from(new Set(requested))) {
      const role = await checkShopRole(supabase, user.id, id)
      if (!role) continue
      allowed.push(id)
      if (await canViewCost(supabase, role, id)) costShops.add(id)
    }
    if (!allowed.length) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    const inList = allowed.join(',')

    const admin = await createAdminClient()
    let query = (admin as any)
      .from('stock_transfers')
      .select('*, stock_transfer_items(*)')
      .or(`source_shop_id.in.(${inList}),destination_shop_id.in.(${inList})`)
      .order('created_at', { ascending: false })

    if (reference) query = query.ilike('reference', reference.trim())

    const { data, error } = await query
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // Deux FK vers shops (source/destination) sur la même ligne — résolues
    // manuellement plutôt que via un embed PostgREST à deux relations ambiguës.
    const shopIds = Array.from(new Set((data || []).flatMap((t: any) => [t.source_shop_id, t.destination_shop_id])))
    const { data: shops } = shopIds.length
      ? await (admin as any).from('shops').select('id, name').in('id', shopIds)
      : { data: [] as any[] }
    const shopMap: Record<string, string> = {}
    for (const s of (shops || [])) shopMap[s.id] = s.name

    // Prix d'achat des lignes : seulement avec le droit de voir les coûts (règle unique canViewCost) ; sinon la
    // colonne est retirée de la réponse — l'écran des transferts n'en a pas besoin.
    // Prix d'achat d'un transfert : visibles si la personne peut voir les coûts dans sa source ou sa destination
    const enriched = (data || []).map((t: any) => ({
      ...t,
      stock_transfer_items: (costShops.has(t.source_shop_id) || costShops.has(t.destination_shop_id)) ? t.stock_transfer_items : (t.stock_transfer_items || []).map(({ buying_price: _cost, ...line }: any) => line),
      source_shop_name: shopMap[t.source_shop_id] || null,
      destination_shop_name: shopMap[t.destination_shop_id] || null,
    }))

    return NextResponse.json({ data: enriched })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/stock-transfers — crée et envoie un transfert dans la même
// transaction (send_stock_transfer) : le stock de la boutique source
// diminue immédiatement, aucun état "brouillon" intermédiaire.
// body: { source_shop_id, destination_shop_id, notes?, items: [{product_id, quantity}] }
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { source_shop_id, destination_shop_id, notes, items } = await request.json()
    if (!source_shop_id || !destination_shop_id)
      return NextResponse.json({ error: t('source_destination_required') }, { status: 400 })
    if (!Array.isArray(items) || items.length === 0)
      return NextResponse.json({ error: t('at_least_one_product_required') }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, source_shop_id)
    if (!role || !(await canWriteFeature(supabase, role, source_shop_id, 'transfers')))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient()
    const { data, error } = await (admin as any).rpc('send_stock_transfer', {
      p_source_shop_id: source_shop_id,
      p_destination_shop_id: destination_shop_id,
      p_performed_by: user.id,
      p_notes: notes || null,
      p_items: items,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    const { data: actorProfile } = await (admin as any).from('profiles').select('full_name').eq('id', user.id).single()
    await writeAuditLog({
      action: 'stock_transfer.send',
      shop_id: source_shop_id,
      actor_id: user.id,
      actor_email: user.email,
      target_id: data?.id,
      target_type: 'stock_transfer',
      ip: getClientIp(request),
      metadata: { actor_name: actorProfile?.full_name || user.email, reference: data?.reference, destination_shop_id },
    })

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
