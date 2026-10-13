import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { getAuthedUser, checkShopRole } from '@/lib/api/shop-auth'
import { canViewFeature, canWriteFeature, canViewCost } from '@/lib/api/role-permissions'
import { getApiTranslator } from '@/lib/api/i18n'
import { coverageInfo, fetchSoldQty30d, stockLevelOf, stockQuantities } from '@/lib/stock/signals'
import { loadStockPipeline } from '@/lib/stock/pipeline-load'

// GET /api/stock/product-detail?shop_id=…&product_id=…[&today=AAAA-MM-JJ]
// Fiche produit (étape 6 de la refonte Stock) — LECTURE SEULE. Tous les
// chiffres sont calculés ici avec les règles communes (lib/stock/signals) :
// l'écran affiche, il ne recalcule pas.
//
// Droits, décidés par le serveur :
//   • voir la fiche              : fonction Stock (consultation) ;
//   • en transit / en commande   : fonctions Transferts / Fournisseurs, sinon
//                                  null (« — » à l'écran, jamais un faux zéro) ;
//   • achat (coût, valeur, fournisseur, prix comparés) : règle unique
//     canViewCost (lib/permissions). Sans ce droit, AUCUN prix d'achat n'est
//     dans la réponse ;
//   • libérer une réservation    : droit de vendre (« Nouvelle vente »), la
//     règle de /api/stock/reservations — rien n'est élargi ici.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Jour de l'appareil s'il est plausible (à un jour près de celui du serveur), sinon jour du serveur. */
function resolveToday(param: string | null): string {
  const server = new Date().toISOString().slice(0, 10)
  if (!param || !/^\d{4}-\d{2}-\d{2}$/.test(param)) return server
  const gap = Math.abs(new Date(param + 'T00:00:00Z').getTime() - new Date(server + 'T00:00:00Z').getTime())
  return gap <= 86_400_000 ? param : server
}

export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { user, supabase } = await getAuthedUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const p = new URL(request.url).searchParams
    const shopId = p.get('shop_id') || '', productId = p.get('product_id') || ''
    if (!UUID.test(shopId) || !UUID.test(productId)) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })

    const role = await checkShopRole(supabase, user.id, shopId)
    if (!role || !(await canViewFeature(supabase, role, shopId, 'stock'))) {
      return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    }
    const [canCost, canRelease, seeTransfers, seeOrders] = await Promise.all([
      canViewCost(supabase, role, shopId),
      canWriteFeature(supabase, role, shopId, 'new_sale'),
      canViewFeature(supabase, role, shopId, 'transfers'),
      canViewFeature(supabase, role, shopId, 'suppliers'),
    ])

    const admin = await createAdminClient() as any
    // Colonnes nommées une à une : le prix d'achat n'est lu que pour qui a le droit de le voir
    const columns = 'id, shop_id, name, sku, unit, quantity, low_stock_threshold, selling_price, promo_price, promo_until, promo_start, image_url, is_active, supplier_id, categories(name, color)'
    const { data: product, error: productError } = await admin.from('products')
      .select(canCost ? `${columns}, buying_price` : columns)
      .eq('id', productId).eq('shop_id', shopId).maybeSingle()
    if (productError) throw productError
    if (!product) return NextResponse.json({ error: t('invalid_data') }, { status: 404 })

    const today = resolveToday(p.get('today'))
    const nowIso = new Date().toISOString()
    const [expiredRes, reservationsRes, pipeline, sold, shopRes] = await Promise.all([
      admin.from('product_batches').select('quantity').eq('product_id', productId).eq('shop_id', shopId).gt('quantity', 0).lt('expiry_date', today),
      admin.from('stock_reservations').select('id, quantity, source_ref, label, created_by, created_at, expires_at')
        .eq('shop_id', shopId).eq('product_id', productId).gt('expires_at', nowIso).order('created_at', { ascending: true }),
      loadStockPipeline(admin, { stockShops: [shopId], transferShops: seeTransfers ? [shopId] : [], orderShops: seeOrders ? [shopId] : [] }),
      fetchSoldQty30d(admin, [shopId], productId),
      admin.from('shops').select('low_stock_threshold').eq('id', shopId).maybeSingle(),
    ])
    if (expiredRes.error) throw expiredRes.error
    if (reservationsRes.error) throw reservationsRes.error

    const rows = (reservationsRes.data || []) as any[]
    const authorIds = Array.from(new Set(rows.map(r => r.created_by).filter(Boolean)))
    const authors: Record<string, string> = {}
    if (authorIds.length) {
      const { data: profiles } = await admin.from('profiles').select('id, full_name').in('id', authorIds)
      for (const a of profiles || []) authors[a.id] = a.full_name
    }

    const quantities = stockQuantities({
      physical: product.quantity,
      expired: (expiredRes.data || []).reduce((n: number, b: any) => n + Number(b.quantity), 0),
      reserved: rows.reduce((n, r) => n + Number(r.quantity), 0),
      inTransit: seeTransfers ? pipeline.byProduct[productId]?.inTransit ?? 0 : null,
      onOrder: seeOrders ? pipeline.byProduct[productId]?.onOrder ?? 0 : null,
    })
    const sold30d = sold[productId] || 0
    // Statut : la règle de la liste (rupture / stock bas sur le disponible, sinon « ventes lentes » sans vente sur 30 j)
    const level = stockLevelOf(
      { id: productId, quantity: product.quantity, low_stock_threshold: product.low_stock_threshold },
      { shopLowStockThreshold: shopRes.data?.low_stock_threshold, expiredQtyByProduct: { [productId]: quantities.expired }, reservedQtyByProduct: { [productId]: quantities.reserved } },
    )
    const status = level !== 'ok' ? level : quantities.physical > 0 && sold30d <= 0 ? 'dormant' : 'ok'

    let purchase: null | Record<string, unknown> = null
    if (canCost) {
      const [{ data: supplier }, { data: prices }, { data: lots }] = await Promise.all([
        product.supplier_id ? admin.from('suppliers').select('id, name').eq('id', product.supplier_id).maybeSingle() : Promise.resolve({ data: null }),
        admin.from('product_supplier_prices').select('supplier_id, price, updated_at, suppliers(name)').eq('shop_id', shopId).eq('product_id', productId).order('price', { ascending: true }),
        admin.from('product_batches').select('id, buying_price').eq('shop_id', shopId).eq('product_id', productId).gt('quantity', 0),
      ])
      const cost = Number(product.buying_price || 0)
      purchase = {
        buying_price: cost,
        // Valeur du stock : quantité PHYSIQUE × coût, la formule de la Vue d'ensemble et des Rapports
        stock_value: quantities.physical * cost,
        supplier: supplier ? { id: supplier.id, name: supplier.name } : null,
        // Coût de chaque lot en stock (le navigateur lit les lots sans cette colonne)
        batch_costs: Object.fromEntries((lots || []).map((l: any) => [l.id, Number(l.buying_price) || 0])),
        supplier_prices: (prices || []).map((sp: any) => ({ supplier_id: sp.supplier_id, supplier_name: sp.suppliers?.name || null, price: Number(sp.price), updated_at: sp.updated_at })),
      }
    }

    const { buying_price: _cost, supplier_id: _supplier, ...safeProduct } = product
    return NextResponse.json({
      product: safeProduct,
      status,
      quantities,
      reservations: rows.map(r => ({
        id: r.id, source_ref: r.source_ref, label: r.label, quantity: Number(r.quantity),
        created_at: r.created_at, expires_at: r.expires_at, created_by_name: r.created_by ? authors[r.created_by] || null : null,
      })),
      sales: { sold30d, coverage: coverageInfo(quantities.physical - quantities.expired, sold30d) },
      purchase,
      permissions: { cost: canCost, release: canRelease },
      today,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
