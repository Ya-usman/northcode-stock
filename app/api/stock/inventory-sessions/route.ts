import { NextResponse } from 'next/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { inventoryAccess, inventoryDbError, actorNames, COUNT_COLUMNS } from '@/lib/api/inventory'

// GET /api/stock/inventory-sessions?shop_id= — état de l'inventaire d'UNE boutique :
//   session en cours (ou aucune), ses comptages courants, la liste des produits À COMPTER — SANS leur stock
//   enregistré (comptage à l'aveugle garanti par le serveur : le théorique n'apparaît qu'une fois le produit compté),
//   catégories, dernier inventaire terminé.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const shopId = new URL(request.url).searchParams.get('shop_id')
    const access = await inventoryAccess(t, shopId, 'view')
    if (!access.ok) return access.response
    const { admin } = access

    const [{ data: session }, { data: products }, { data: categories }, { data: last }, { count: historyCount }] = await Promise.all([
      admin.from('inventory_sessions').select('id, reference, status, started_by, started_at, products_total, updated_at')
        .eq('shop_id', shopId).eq('status', 'in_progress').maybeSingle(),
      admin.from('products').select('id, name, unit, sku, category_id').eq('shop_id', shopId).eq('is_active', true).order('name'),
      admin.from('categories').select('id, name').eq('shop_id', shopId).order('name'),
      admin.from('inventory_sessions').select('id, reference, completed_at, legacy').eq('shop_id', shopId).eq('status', 'completed')
        .order('completed_at', { ascending: false }).limit(1).maybeSingle(),
      admin.from('inventory_sessions').select('id', { count: 'exact', head: true }).eq('shop_id', shopId).neq('status', 'in_progress'),
    ])

    let counts: any[] = []
    if (session) {
      const { data } = await admin.from('inventory_counts').select(COUNT_COLUMNS)
        .eq('session_id', session.id).is('superseded_at', null)
      counts = data || []
    }
    const names = await actorNames(admin, [session?.started_by, ...counts.map(c => c.counted_by)])

    // Droit de compter (l'écran n'affiche pas les actions sans ce droit ; le serveur les refuse de toute façon)
    const canWrite = await access.canWrite()

    return NextResponse.json({
      session: session ? { ...session, started_by_name: names[session.started_by] ?? null } : null,
      counts: counts.map(c => ({ ...c, counted_by_name: names[c.counted_by] ?? null })),
      products: products || [],
      categories: categories || [],
      last_completed: last ?? null,
      has_history: (historyCount ?? 0) > 0,
      can_write: canWrite,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST /api/stock/inventory-sessions — démarrer l'inventaire de la boutique (ou reprendre celui en cours)
// body: { shop_id } — aucun stock modifié
export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const { shop_id } = await request.json()
    const access = await inventoryAccess(t, shop_id, 'write')
    if (!access.ok) return access.response
    const { data, error } = await access.admin.rpc('start_inventory_session', { p_shop_id: shop_id, p_user: access.userId })
    if (error) return inventoryDbError(t, error)
    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
