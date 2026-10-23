import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { loadShopAccess, parseShopIds } from '@/lib/api/shop-access'
import { fetchAllRows, fetchShopPayments } from '@/lib/dashboard/fetch-rows'

// GET /api/dashboard/expense-revenue?shop_ids=a,b&from=ISO&to=ISO
// Graphique « Revenus vs dépenses » (6 mois) : chiffre d'affaires de TOUTE la boutique, donc seulement là où
// « chiffre d'affaires de la boutique » (revenue_chart) est autorisé ; dépenses seulement là où « Dépenses » l'est
// aussi (jamais pour un rôle caissier). Décidé par le SERVEUR — avant : lecture directe par le navigateur, la base ne
// contrôlant que l'appartenance à la boutique.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const sp = new URL(request.url).searchParams
    const shopIds = parseShopIds(sp.get('shop_ids'))
    const from = sp.get('from') || '', to = sp.get('to') || ''
    if (!shopIds || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) {
      return NextResponse.json({ error: t('missing_params') }, { status: 400 })
    }
    const access = await loadShopAccess(supabase, user.id, shopIds)
    if (access.length !== shopIds.length) return NextResponse.json({ error: t('shop_access_denied') }, { status: 403 })
    const revenueShops = access.filter(a => a.view('revenue_chart')).map(a => a.shopId)
    if (!revenueShops.length) return NextResponse.json({ error: t('permission_denied') }, { status: 403 })
    const expenseShops = access.filter(a => a.view('revenue_chart') && a.role !== 'cashier' && a.view('expenses')).map(a => a.shopId)

    const admin = await createAdminClient() as any
    const [payments, expenses] = await Promise.all([
      fetchShopPayments(admin, revenueShops, from, to),
      expenseShops.length ? fetchAllRows<any>(() => admin
        .from('expenses').select('date, amount, shop_id')
        .in('shop_id', expenseShops).eq('is_recurring', false)
        .gte('date', from.slice(0, 10)).lte('date', to.slice(0, 10))
        .order('date').order('id')) : Promise.resolve([]),
    ])
    return NextResponse.json({
      payments: payments.map((p: any) => ({ paid_at: p.paid_at, amount: Number(p.amount), shop_id: p.sales?.shop_id })),
      expenses: (expenses as any[]).map(e => ({ date: e.date, amount: Number(e.amount), shop_id: e.shop_id })),
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
