import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { loadShopAccess, parseShopIds, sellerFilter } from '@/lib/api/shop-access'
import { fetchAllRows, fetchShopPayments } from '@/lib/dashboard/fetch-rows'

// GET /api/dashboard/summary?shop_ids=a,b&day_start&day_end&month_start&month_end
// Chiffres du tableau de bord que le navigateur lisait directement (la base ne contrôle que l'appartenance à la
// boutique : un caissier recevait l'encaissé de toute la boutique et les dépenses, même non affichés). Le SERVEUR
// décide, boutique par boutique (lib/api/shop-access) :
//   • remboursements du jour (fil des ventes) : vendeur limité à SES ventes selon son rôle et les réglages ;
//   • mes encaissements du mois : ce que la personne a elle-même encaissé ;
//   • encaissé global du mois : seulement là où « chiffre d'affaires de la boutique » (revenue_chart) est autorisé ;
//   • dépenses du mois : seulement là où « Dépenses » est autorisé, jamais pour un rôle caissier (règle de l'écran).
// Un champ absent (null) = aucune boutique du périmètre ne l'autorise.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const sp = new URL(request.url).searchParams
    const shopIds = parseShopIds(sp.get('shop_ids'))
    const bounds = ['day_start', 'day_end', 'month_start', 'month_end'].map(k => sp.get(k) || '')
    if (!shopIds || bounds.some(b => !b || Number.isNaN(Date.parse(b)))) {
      return NextResponse.json({ error: t('missing_params') }, { status: 400 })
    }
    const [dayStart, dayEnd, monthStart, monthEnd] = bounds

    const access = await loadShopAccess(supabase, user.id, shopIds)
    if (access.length !== shopIds.length) return NextResponse.json({ error: t('shop_access_denied') }, { status: 403 })

    const admin = await createAdminClient() as any
    const seller: Record<string, string | null> = {}
    for (const a of access) seller[a.shopId] = sellerFilter(a, user.id)
    const globalShops = access.filter(a => a.view('revenue_chart')).map(a => a.shopId)
    const expenseShops = access.filter(a => a.role !== 'cashier' && a.view('expenses')).map(a => a.shopId)
    const feedShops = access.filter(a => a.view('widget_recent_sales')).map(a => a.shopId)

    const [repayments, mine, global, expenses] = await Promise.all([
      // Remboursements du jour, hors ventes annulées / paiements annulés / abandons de créance
      feedShops.length ? fetchAllRows<any>(() => admin
        .from('payments')
        .select('id, sale_id, amount, paid_at, method, is_cancelled, is_write_off, sales!inner(shop_id, cashier_id, sale_number, created_at, total, balance, payment_method, customers(name), sale_status)')
        .in('sales.shop_id', feedShops).eq('is_repayment', true)
        .gte('paid_at', dayStart).lte('paid_at', dayEnd)
        .order('paid_at', { ascending: false }).order('id')) : Promise.resolve([]),
      // Ce que la personne a elle-même encaissé ce mois-ci
      fetchAllRows<any>(() => admin
        .from('payments').select('amount, sales!inner(shop_id, sale_status)')
        .in('sales.shop_id', shopIds).neq('sales.sale_status', 'cancelled')
        .eq('is_cancelled', false).eq('is_write_off', false).eq('received_by', user.id)
        .gte('paid_at', monthStart).lte('paid_at', monthEnd)
        .order('paid_at').order('id')),
      globalShops.length ? fetchShopPayments(admin, globalShops, monthStart, monthEnd) : Promise.resolve(null),
      expenseShops.length ? fetchAllRows<any>(() => admin
        .from('expenses').select('amount, shop_id')
        .in('shop_id', expenseShops).eq('is_recurring', false)
        .gte('date', monthStart.slice(0, 10)).lte('date', monthEnd.slice(0, 10))
        .order('date').order('id')) : Promise.resolve(null),
    ])

    const feed = (repayments as any[]).filter(p =>
      p.sales?.sale_status !== 'cancelled' && !p.is_cancelled && !p.is_write_off &&
      (!seller[p.sales?.shop_id] || p.sales?.cashier_id === seller[p.sales?.shop_id]))
    const sum = (rows: any[] | null) => rows === null ? null : rows.reduce((n, r) => n + Number(r.amount), 0)

    return NextResponse.json({
      repayments: feed.map(p => ({ ...p, sales: { ...p.sales, cashier_id: undefined } })),
      month_revenue_own: sum(mine),
      month_global_revenue: sum(global as any[] | null),
      month_expenses: sum(expenses as any[] | null),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
