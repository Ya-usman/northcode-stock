import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { canViewFeature, canViewCost } from '@/lib/api/role-permissions'
import { fetchAllRows } from '@/lib/dashboard/fetch-rows'

// POST /api/reports/margin   { shop_ids: string[], sale_ids: string[] }
// Les chiffres des Rapports qui découlent du prix d'achat : coût des ventes
// (pour la marge brute et le bénéfice), valeur d'achat du stock, coût par
// produit. LECTURE SEULE — POST seulement parce que la liste des ventes peut
// être longue.
//
// DEUX conditions, pour CHAQUE boutique demandée (règle du 13 oct. 2026) :
//   accès aux Rapports  ET  droit de voir les coûts (canViewCost).
// L'une sans l'autre → 403. Le droit de voir les coûts n'ouvre pas les
// Rapports ; l'accès aux Rapports ne donne pas la marge. Si une seule des
// boutiques affichées n'est pas autorisée, rien n'est renvoyé : une marge
// calculée sur une partie des ventes affichées serait fausse.
//
// Le coût est calculé sur les ventes que l'écran affiche (`sale_ids`), pour
// rester cohérent avec son chiffre d'affaires — seules celles des boutiques
// autorisées sont lues.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_SALES = 20_000
const CHUNK = 150

export async function POST(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const body = await request.json().catch(() => null)
    const shopIds: string[] = Array.from(new Set(Array.isArray(body?.shop_ids) ? body.shop_ids.filter((x: unknown) => typeof x === 'string' && UUID.test(x)) : []))
    const saleIds: string[] = Array.from(new Set(Array.isArray(body?.sale_ids) ? body.sale_ids.filter((x: unknown) => typeof x === 'string' && UUID.test(x)) : []))
    if (!shopIds.length || saleIds.length > MAX_SALES) return NextResponse.json({ error: t('invalid_data') }, { status: 400 })

    const { data: members } = await supabase
      .from('shop_members').select('shop_id, role')
      .in('shop_id', shopIds).eq('user_id', user.id).eq('is_active', true)
    const allowed: string[] = []
    await Promise.all((members || []).map(async (m: any) => {
      const [reports, cost] = await Promise.all([canViewFeature(supabase, m.role, m.shop_id, 'reports'), canViewCost(supabase, m.role, m.shop_id)])
      if (reports && cost) allowed.push(m.shop_id)
    }))
    if (allowed.length !== shopIds.length) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any
    let cogs = 0
    for (let i = 0; i < saleIds.length; i += CHUNK) {
      const chunk = saleIds.slice(i, i + CHUNK)
      const items = await fetchAllRows<{ quantity: number; buying_price: number | null }>(() => admin
        .from('sale_items').select('id, quantity, buying_price, sales!inner(shop_id)')
        .in('sale_id', chunk).in('sales.shop_id', allowed)
        .order('id', { ascending: true }))
      for (const it of items) cogs += Number(it.buying_price || 0) * Number(it.quantity)
    }
    const products = await fetchAllRows<{ id: string; quantity: number; buying_price: number | null }>(() => admin
      .from('products').select('id, quantity, buying_price')
      .in('shop_id', allowed).eq('is_active', true).order('id', { ascending: true }))
    let stockBuyingValue = 0
    const productCosts: Record<string, number> = {}
    for (const p of products) { const c = Number(p.buying_price) || 0; productCosts[p.id] = c; stockBuyingValue += Number(p.quantity) * c }

    return NextResponse.json({ cogs, stock_buying_value: stockBuyingValue, product_costs: productCosts })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
