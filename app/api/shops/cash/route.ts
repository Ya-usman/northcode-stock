import { NextResponse } from 'next/server'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { getApiTranslator } from '@/lib/api/i18n'
import { loadShopAccess, ownSalesScope, parseShopIds } from '@/lib/api/shop-access'
import { fetchAllRows } from '@/lib/dashboard/fetch-rows'

// GET /api/shops/cash?shop_id=<id>&day_start=<début du jour, heure de l'appareil>&review=1
// Onglet Caisse de la fiche boutique (lib/shops/shop-detail-data → useShopCashDetail), lu jusqu'ici DIRECTEMENT par le
// navigateur (lot 2B, 26 oct. 2026). Mêmes calculs, mêmes droits qu'avant, décidés par le SERVEUR :
//   • encaissé du jour (total, remboursements, par moyen, par personne) et nombre de ventes du jour : avec l'un des
//     droits qui ouvrent l'onglet (« Contrôle de caisse », « Crédits », « Historique ») ; caissier et magasinier
//     limités à leurs ventes (ownSalesScope : mêmes chiffres que lorsque la base filtrait elle-même) ;
//   • ventes « à vérifier » (5 dernières + nombre) : avec « Historique des ventes », et seulement si demandées.
// Bloc non autorisé = null.
export async function GET(request: Request) {
  const t = getApiTranslator(request)
  try {
    const supabase = await createClient() as any
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: t('not_authenticated') }, { status: 401 })

    const sp = new URL(request.url).searchParams
    const ids = parseShopIds(sp.get('shop_id'))
    const dayStart = sp.get('day_start') || ''
    if (!ids || ids.length !== 1 || !dayStart || Number.isNaN(Date.parse(dayStart))) {
      return NextResponse.json({ error: t('missing_params') }, { status: 400 })
    }
    const [access] = await loadShopAccess(supabase, user.id, ids)
    if (!access) return NextResponse.json({ error: t('shop_access_denied') }, { status: 403 })
    const shopId = access.shopId
    const seller = ownSalesScope(access, user.id)
    const showToday = access.view('caisse') || access.view('payments') || access.view('sales_history')
    const showReview = sp.get('review') === '1' && access.view('sales_history')
    const admin = await createAdminClient() as any

    const [payments, salesCount, review] = await Promise.all([
      showToday ? fetchAllRows<any>(() => {
        let q = admin.from('payments')
          .select('id, amount, method, is_repayment, received_by, sales!inner(shop_id, sale_status, cashier_id)')
          .eq('sales.shop_id', shopId).eq('is_cancelled', false).eq('is_write_off', false).gte('paid_at', dayStart)
        if (seller) q = q.eq('sales.cashier_id', seller)
        return q.order('paid_at').order('id')
      }) : Promise.resolve(null),
      showToday ? (() => {
        let q = admin.from('sales').select('id', { count: 'exact', head: true })
          .eq('shop_id', shopId).eq('sale_status', 'active').gte('created_at', dayStart)
        if (seller) q = q.eq('cashier_id', seller)
        return q.then((r: any) => { if (r.error) throw new Error(r.error.message); return r.count as number })
      })() : Promise.resolve(null),
      showReview ? (() => {
        let q = admin.from('sales').select('id, sale_number, created_at, review_reason', { count: 'exact' })
          .eq('shop_id', shopId).not('review_reason', 'is', null).is('reviewed_at', null)
        if (seller) q = q.eq('cashier_id', seller)
        return q.order('created_at', { ascending: false }).limit(5)
          .then((r: any) => { if (r.error) throw new Error(r.error.message); return { rows: r.data || [], count: r.count || 0 } })
      })() : Promise.resolve(null),
    ])

    let today: any = null
    if (payments) {
      const byMethod: Record<string, number> = {}
      const byPerson: Record<string, { amount: number; count: number }> = {}
      let total = 0, repayments = 0
      for (const p of payments) {
        if (p.sales?.sale_status === 'cancelled') continue
        const amount = Number(p.amount) || 0
        total += amount
        if (p.is_repayment) repayments += amount
        byMethod[p.method || 'cash'] = (byMethod[p.method || 'cash'] || 0) + amount
        // Comme le Contrôle de caisse : la vente au vendeur, le remboursement à qui l'a reçu
        const who = (p.is_repayment ? p.received_by : p.sales?.cashier_id) || 'unknown'
        byPerson[who] = byPerson[who] || { amount: 0, count: 0 }
        byPerson[who].amount += amount
        byPerson[who].count++
      }
      const people = Object.keys(byPerson).filter(id => id !== 'unknown')
      const names: Record<string, string> = {}
      if (people.length) {
        const { data } = await admin.from('profiles').select('id, full_name').in('id', people)
        for (const pr of data || []) names[pr.id] = pr.full_name
      }
      today = {
        total, repayments, salesCount: salesCount || 0,
        byMethod: Object.entries(byMethod).map(([method, amount]) => ({ method, amount })).sort((a, b) => b.amount - a.amount),
        byPerson: Object.entries(byPerson).map(([id, v]) => ({ id, name: names[id] ?? null, ...v })).sort((a, b) => b.amount - a.amount),
      }
    }
    return NextResponse.json({
      today,
      review: review && {
        count: review.count,
        list: review.rows.map((s: any) => ({
          id: s.id, sale_number: s.sale_number, created_at: s.created_at,
          reasons: String(s.review_reason || '').split(',').filter(Boolean),
        })),
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
