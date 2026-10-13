import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canViewFeature } from '@/lib/api/role-permissions'
import { describeMovement } from '@/lib/stock/movement-label'

// GET /api/stock/movements/<id> — détail d'UN mouvement de stock : ce que la base a enregistré, le produit, la
// boutique, et l'origine quand elle existe vraiment (la vente, le bon de commande ou le transfert cité dans le
// motif, retrouvé dans la même boutique). Lecture seule. Aucun prix d'achat, aucune valeur : la réponse n'en
// contient pour personne.
// Droit : voir « Mouvements » ou voir « Stock » dans la boutique du mouvement.
// `can_open` : l'écran de destination existe ET cet utilisateur y a accès — sinon aucun bouton n'est proposé.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const t = getApiTranslator(request)
  try {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const admin = await createAdminClient() as any
    const { data: row } = await admin
      .from('stock_movements')
      .select('id, shop_id, product_id, type, quantity, previous_qty, new_qty, reason, notes, performed_by, created_at, count_session_id')
      .eq('id', params.id).maybeSingle()
    // Même réponse pour « n'existe pas » et « pas à vous » : l'existence d'un mouvement ne se devine pas
    const role = row ? await checkShopRole(supabase, user.id, row.shop_id) : null
    if (!row || !role) return NextResponse.json({ error: t('record_not_found') }, { status: 404 })
    const shopId: string = row.shop_id
    if (!(await canViewFeature(supabase, role, shopId, 'movements')) && !(await canViewFeature(supabase, role, shopId, 'stock')))
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const [productRes, shopRes, profileRes] = await Promise.all([
      row.product_id ? admin.from('products').select('id, name, sku, unit, image_url').eq('id', row.product_id).maybeSingle() : Promise.resolve({ data: null }),
      admin.from('shops').select('name').eq('id', shopId).maybeSingle(),
      row.performed_by ? admin.from('profiles').select('full_name').eq('id', row.performed_by).maybeSingle() : Promise.resolve({ data: null }),
    ])

    const inventoryCount = !!row.count_session_id
    const described = describeMovement({ type: row.type, reason: row.reason, inventory_count: inventoryCount }).origin
    let origin: any = null
    if (described?.kind === 'sale') {
      const { data: sales } = await admin.from('sales').select('id, sale_number, sale_status, created_at').eq('shop_id', shopId).eq('sale_number', described.ref).limit(2)
      if (sales?.length === 1) {
        // L'historique ne montre à un vendeur que ses propres ventes : le bouton n'apparaît que s'il peut lire celle-ci
        const { data: readable } = await supabase.from('sales').select('id').eq('id', sales[0].id).maybeSingle()
        origin = {
          kind: 'sale', ref: sales[0].sale_number, status: sales[0].sale_status, created_at: sales[0].created_at,
          can_open: !!readable && await canViewFeature(supabase, role, shopId, 'sales_history'),
        }
      }
    } else if (described?.kind === 'purchase_order') {
      const { data: orders } = await admin.from('purchase_orders').select('id, reference, suppliers(name)').eq('shop_id', shopId).eq('reference', described.ref).limit(2)
      if (orders?.length === 1) {
        origin = {
          kind: 'purchase_order', ref: orders[0].reference, supplier_name: orders[0].suppliers?.name || null,
          can_open: await canViewFeature(supabase, role, shopId, 'suppliers'),
        }
      }
    } else if (described?.kind === 'transfer') {
      const { data: transfers } = await admin.from('stock_transfers').select('id, reference, source_shop_id, destination_shop_id')
        .eq('reference', described.ref).or(`source_shop_id.eq.${shopId},destination_shop_id.eq.${shopId}`).limit(2)
      if (transfers?.length === 1) {
        const tr = transfers[0]
        const { data: shops } = await admin.from('shops').select('id, name').in('id', [tr.source_shop_id, tr.destination_shop_id])
        const nameOf = (id: string) => (shops || []).find((s: any) => s.id === id)?.name || null
        origin = {
          kind: 'transfer', ref: tr.reference, source_shop: nameOf(tr.source_shop_id), destination_shop: nameOf(tr.destination_shop_id),
          can_open: await canViewFeature(supabase, role, shopId, 'transfers'),
        }
      }
    }

    return NextResponse.json({
      movement: {
        id: row.id,
        shop_id: shopId,
        shop_name: shopRes.data?.name || null,
        type: row.type,
        quantity: row.quantity,
        previous_qty: row.previous_qty ?? null,
        new_qty: row.new_qty ?? null,
        reason: row.reason,
        notes: row.notes,
        created_at: row.created_at,
        inventory_count: inventoryCount,
        performed_by_name: profileRes.data?.full_name || null,
        product: productRes.data
          ? { id: productRes.data.id, name: productRes.data.name, sku: productRes.data.sku || null, unit: productRes.data.unit || null, image_url: productRes.data.image_url || null }
          : null,
      },
      origin,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
