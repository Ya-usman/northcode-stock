import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { canViewCost, canViewFeature } from '@/lib/api/role-permissions'
import { fetchAllRows } from '@/lib/dashboard/fetch-rows'
import { resolveCurrencyCode } from '@/lib/saas/currencies'

// GET /api/stock/valuation?shop_ids=a,b — Stock › Valorisation (étape 7, 31 oct. 2026). Lecture seule.
// Droit : « Stock » ET prix d'achat (canViewCost), boutique par boutique ; les autres boutiques sont ignorées.
// Par devise (une entreprise peut avoir des boutiques en devises différentes) :
//   coût moyen   Σ quantité physique (bornée à 0) × coût moyen du produit (products.buying_price) — formule de la
//                Vue d'ensemble et des Rapports ;
//   FIFO         chaque lot en stock à SON prix d'achat (product_batches.buying_price) ; un lot sans coût connu et le
//                stock hors lot prennent le coût moyen ;
//   vente        Σ quantité × prix de vente ; marge potentielle = vente − coût moyen ;
//   coût inconnu produits en stock dont le coût moyen est 0 : leur stock n'est pas valorisé (signalé, jamais inventé).
// Détail : par catégorie, et les 10 produits qui pèsent le plus.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const shopIds = (new URL(request.url).searchParams.get('shop_ids') || '').split(',').map(s => s.trim()).filter(Boolean)
    if (!shopIds.length) return NextResponse.json({ error: t('shop_ids_required') }, { status: 400 })

    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })
    const { data: members } = await supabase.from('shop_members').select('shop_id, role').in('shop_id', shopIds).eq('user_id', user.id).eq('is_active', true)
    const allowed: string[] = []
    await Promise.all((members || []).map(async (m: any) => {
      const [stock, cost] = await Promise.all([canViewFeature(supabase, m.role, m.shop_id, 'stock'), canViewCost(supabase, m.role, m.shop_id)])
      if (stock && cost) allowed.push(m.shop_id)
    }))
    if (!allowed.length) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })

    const admin = await createAdminClient() as any
    const [{ data: shops }, products, batches, { data: categories }] = await Promise.all([
      admin.from('shops').select('id, currency, country').in('id', allowed),
      fetchAllRows<any>(() => admin.from('products').select('id, shop_id, name, quantity, buying_price, selling_price, category_id')
        .in('shop_id', allowed).eq('is_active', true).order('id', { ascending: true })),
      fetchAllRows<any>(() => admin.from('product_batches').select('id, product_id, quantity, buying_price, received_at, created_at')
        .in('shop_id', allowed).gt('quantity', 0).order('id', { ascending: true })),
      admin.from('categories').select('id, name, color').in('shop_id', allowed),
    ])
    const currencyOf: Record<string, string> = Object.fromEntries((shops || []).map((s: any) => [s.id, resolveCurrencyCode(s.currency, s.country)]))
    const catName: Record<string, { name: string; color: string | null }> = Object.fromEntries((categories || []).map((c: any) => [c.id, { name: c.name, color: c.color ?? null }]))
    const lotsOf: Record<string, { quantity: number; cost: number | null }[]> = {}
    // FIFO : les lots les plus récents restent en stock (les plus anciens partent d'abord) ; s'il y a plus de lots que de
    // stock (incohérence), on garde donc les plus récents
    const lotTime = (b: any) => Date.parse(b.received_at || b.created_at || '') || 0
    for (const b of [...batches].sort((x, y) => lotTime(y) - lotTime(x))) (lotsOf[b.product_id] ||= []).push({ quantity: Number(b.quantity) || 0, cost: b.buying_price == null ? null : Number(b.buying_price) })

    type Totals = { average: number; fifo: number; selling: number; quantity: number; products: number; unknown_cost: number }
    const byCurrency: Record<string, Totals & {
      categories: Record<string, { name: string | null; color: string | null; quantity: number; average: number }>
      top: { id: string; shop_id: string; name: string; quantity: number; average: number; fifo: number }[]
      unknown: { id: string; shop_id: string; name: string; quantity: number }[]
      /** Prix des lots éloigné du coût moyen (> 5 %) : en général un prix d'achat modifié à la main sur la fiche, qui ne
       *  touche pas les lots. Signalé pour vérification, jamais corrigé automatiquement (les lots gardent leur prix de réception). */
      mismatch: { id: string; shop_id: string; name: string; quantity: number; average: number; fifo: number }[]
    }> = {}

    for (const p of products) {
      const qty = Math.max(0, Number(p.quantity) || 0)
      if (qty <= 0) continue
      const code = currencyOf[p.shop_id] || 'XAF'
      const cur = byCurrency[code] ||= { average: 0, fifo: 0, selling: 0, quantity: 0, products: 0, unknown_cost: 0, categories: {}, top: [], unknown: [], mismatch: [] }
      const avg = Number(p.buying_price) || 0
      const average = qty * avg
      // FIFO : les lots en stock à leur prix (coût inconnu → coût moyen), le reste hors lot au coût moyen
      let lotted = 0, fifo = 0
      for (const l of lotsOf[p.id] || []) {
        const q = Math.min(l.quantity, qty - lotted)
        if (q <= 0) break
        fifo += q * (l.cost && l.cost > 0 ? l.cost : avg)
        lotted += q
      }
      fifo += Math.max(0, qty - lotted) * avg
      cur.average += average
      cur.fifo += fifo
      cur.selling += qty * (Number(p.selling_price) || 0)
      cur.quantity += qty
      cur.products += 1
      if (avg <= 0) { cur.unknown_cost += 1; cur.unknown.push({ id: p.id, shop_id: p.shop_id, name: p.name, quantity: qty }) }
      const key = p.category_id || 'none'
      const cat = cur.categories[key] ||= { name: p.category_id ? catName[p.category_id]?.name ?? null : null, color: p.category_id ? catName[p.category_id]?.color ?? null : null, quantity: 0, average: 0 }
      cat.quantity += qty
      cat.average += average
      cur.top.push({ id: p.id, shop_id: p.shop_id, name: p.name, quantity: qty, average, fifo })
      if (avg > 0 && Math.abs(fifo - average) > 0.05 * average) cur.mismatch.push({ id: p.id, shop_id: p.shop_id, name: p.name, quantity: qty, average, fifo })
    }
    const round = (n: number) => Math.round(n * 100) / 100
    const out = Object.entries(byCurrency).map(([currency, c]) => ({
      currency,
      average: round(c.average), fifo: round(c.fifo), selling: round(c.selling),
      potential_margin: round(c.selling - c.average),
      quantity: c.quantity, products: c.products, unknown_cost: c.unknown_cost,
      categories: Object.entries(c.categories).map(([id, x]) => ({ id: id === 'none' ? null : id, ...x, average: round(x.average) }))
        .sort((a, b) => b.average - a.average),
      top: c.top.sort((a, b) => b.average - a.average).slice(0, 10).map(x => ({ ...x, average: round(x.average), fifo: round(x.fifo) })),
      unknown: c.unknown.sort((a, b) => b.quantity - a.quantity).slice(0, 50),
      mismatch: c.mismatch.sort((a, b) => Math.abs(b.fifo - b.average) - Math.abs(a.fifo - a.average)).slice(0, 20)
        .map(x => ({ ...x, average: round(x.average), fifo: round(x.fifo) })),
      mismatch_count: c.mismatch.length,
    })).sort((a, b) => b.average - a.average)

    return NextResponse.json({ shops: allowed, by_currency: out })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
