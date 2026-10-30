import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { canViewCost, canViewFeature, canWriteFeature } from '@/lib/api/role-permissions'
import { loadReplenishment, type ReplenishShopScope } from '@/lib/stock/replenishment-load'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/stock/replenishment?shop_ids=a,b[&include=<produit>]
// Produits à commander (règle unique : lib/stock/replenishment), groupables par fournisseur. Lecture seule : les bons
// sont créés ensuite par /api/purchase-orders (brouillons, jamais envoyés d'office).
//
// Droits, boutique par boutique : il faut voir le Stock. Prix d'achat seulement avec le droit au coût (canViewCost) ;
// chiffres « en commande / en brouillon » seulement à qui voit les Fournisseurs, « en transit » à qui voit les
// Transferts (le calcul, lui, les déduit toujours : jamais de double commande) ; `can_order` = Fournisseurs en
// modification (création des bons). `include` : un produit demandé (bouton « Commander ») renvoyé même sans besoin.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const url = new URL(request.url)
    const shopIds = Array.from(new Set((url.searchParams.get('shop_ids') || '').split(',').map(s => s.trim()).filter(s => UUID.test(s))))
    if (!shopIds.length) return NextResponse.json({ error: t('shop_ids_required') }, { status: 400 })
    const include = url.searchParams.get('include')

    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { data: members } = await supabase
      .from('shop_members').select('shop_id, role')
      .in('shop_id', shopIds).eq('user_id', user.id).eq('is_active', true)

    const scopes: ReplenishShopScope[] = []
    await Promise.all((members || []).map(async (m: any) => {
      if (!(await canViewFeature(supabase, m.role, m.shop_id, 'stock'))) return
      const [seesOrders, seesTransfers, canOrder, cost] = await Promise.all([
        canViewFeature(supabase, m.role, m.shop_id, 'suppliers'),
        canViewFeature(supabase, m.role, m.shop_id, 'transfers'),
        canWriteFeature(supabase, m.role, m.shop_id, 'suppliers'),
        canViewCost(supabase, m.role, m.shop_id),
      ])
      scopes.push({ id: m.shop_id, canOrder, canViewCost: cost, seesOrders, seesTransfers })
    }))
    if (!scopes.length) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    scopes.sort((a, b) => shopIds.indexOf(a.id) - shopIds.indexOf(b.id))

    const admin = await createAdminClient() as any
    const data = await loadReplenishment(admin, scopes, { include: include && UUID.test(include) ? include : null })
    return NextResponse.json(data)
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
