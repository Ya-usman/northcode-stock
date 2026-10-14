import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { canViewCost } from '@/lib/api/role-permissions'
import { fetchAllRows } from '@/lib/dashboard/fetch-rows'

// GET /api/costs?shop_ids=a,b[&batches=1]
// LA source des prix d'achat pour les écrans (Stock, Catégories, Boutiques,
// Péremptions, Inventaire, Fournisseurs…). Le navigateur ne lit plus ces
// colonnes lui-même : il lit les produits sans leur coût (lib/products/columns)
// puis, si la personne en a le droit, demande les coûts ici.
//
// Droit : canViewCost, boutique par boutique (lib/permissions — propriétaire,
// Stock en modification ou Fournisseurs en modification). Seules les boutiques
// autorisées sont lues ; `shops` dit lesquelles. Aucune autorisée → 403.
// Ce droit n'ouvre aucun écran : la route ne renvoie que des coûts, rien qui
// permette d'afficher une page à laquelle la personne n'a pas accès.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const p = new URL(request.url).searchParams
    const shopIds = (p.get('shop_ids') || '').split(',').map(s => s.trim()).filter(Boolean)
    if (!shopIds.length) return NextResponse.json({ error: t('shop_ids_required') }, { status: 400 })

    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const { data: members } = await supabase
      .from('shop_members').select('shop_id, role')
      .in('shop_id', shopIds).eq('user_id', user.id).eq('is_active', true)
    const allowed: string[] = []
    await Promise.all((members || []).map(async (m: any) => {
      if (await canViewCost(supabase, m.role, m.shop_id)) allowed.push(m.shop_id)
    }))
    if (!allowed.length) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any
    const [products, batches] = await Promise.all([
      fetchAllRows<{ id: string; buying_price: number | null }>(() => admin
        .from('products').select('id, buying_price')
        .in('shop_id', allowed).order('id', { ascending: true })),
      p.get('batches') === '1'
        ? fetchAllRows<{ id: string; buying_price: number | null }>(() => admin
            .from('product_batches').select('id, buying_price')
            .in('shop_id', allowed).gt('quantity', 0).order('id', { ascending: true }))
        : Promise.resolve([]),
    ])
    const byId = (rows: { id: string; buying_price: number | null }[]) => Object.fromEntries(rows.map(r => [r.id, Number(r.buying_price) || 0]))
    // Lot : un coût inconnu reste inconnu (null), jamais 0 — l'écran n'affiche alors pas de valeur
    const lotCosts = Object.fromEntries(batches.map(r => [r.id, r.buying_price == null ? null : Number(r.buying_price)]))
    return NextResponse.json({ shops: allowed, products: byId(products), batches: lotCosts })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
