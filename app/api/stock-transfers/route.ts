import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { hasRolePermission } from '@/lib/api/role-permissions'
import { writeAuditLog, getClientIp } from '@/lib/api/audit'

// GET /api/stock-transfers?shop_id=&reference= — liste des transferts où la
// boutique est source OU destination ; reference filtre sur un numéro précis
// (recherche "entrer le numéro du bon" côté boutique destination).
export async function GET(request: Request) {
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const shopId = searchParams.get('shop_id')
    const reference = searchParams.get('reference')
    if (!shopId) return NextResponse.json({ error: 'shop_id requis' }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shopId)
    if (!role) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

    const admin = await createAdminClient()
    let query = (admin as any)
      .from('stock_transfers')
      .select('*, stock_transfer_items(*)')
      .or(`source_shop_id.eq.${shopId},destination_shop_id.eq.${shopId}`)
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

    const enriched = (data || []).map((t: any) => ({
      ...t,
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
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })

    const { source_shop_id, destination_shop_id, notes, items } = await request.json()
    if (!source_shop_id || !destination_shop_id)
      return NextResponse.json({ error: 'source_shop_id et destination_shop_id requis' }, { status: 400 })
    if (!Array.isArray(items) || items.length === 0)
      return NextResponse.json({ error: 'Au moins un produit est requis' }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, source_shop_id)
    if (!role || !(await hasRolePermission(supabase, role, source_shop_id, 'transfers')))
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

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
