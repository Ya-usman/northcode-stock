import { createClient } from '@/lib/supabase/server'
import { getTrialDaysLeft, hasActiveSubscription, PLANS } from '@/lib/saas/plans'
import { formatNaira } from '@/lib/utils/currency'
import {
  TrendingUp, ShoppingBag, Users, AlertTriangle, DollarSign,
  ArrowUpRight, Package, Activity, Clock, UserCheck,
} from 'lucide-react'
import { RevenueChart } from '@/components/admin/revenue-chart'
import { RecentPayments } from '@/components/admin/recent-payments'
import Link from 'next/link'

async function getData(supabase: any) {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString()
  const start7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const cutoff14d = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const cutoff3d = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()

  const [
    { data: shops },
    { data: allSubs },
    { data: thisMonthSubs },
    { data: lastMonthSubs },
    { data: owners },
    { count: totalProducts },
    { count: totalCustomers },
    { count: salesToday },
    { count: sales7d },
  ] = await Promise.all([
    supabase.from('shops').select('id, name, plan, trial_ends_at, plan_expires_at, created_at, is_active').order('created_at', { ascending: false }),
    supabase.from('subscriptions').select('id, shop_id, plan, amount, status, paystack_reference, starts_at, created_at').order('created_at', { ascending: false }),
    supabase.from('subscriptions').select('amount').eq('status', 'active').gte('created_at', startOfMonth),
    supabase.from('subscriptions').select('amount').eq('status', 'active').gte('created_at', startOfLastMonth).lte('created_at', endOfLastMonth),
    supabase.from('profiles').select('id, full_name, shop_id, last_seen').eq('role', 'owner'),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('customers').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    supabase.from('sales').select('id', { count: 'exact', head: true }).gte('created_at', startToday),
    supabase.from('sales').select('id', { count: 'exact', head: true }).gte('created_at', start7d),
  ])

  return {
    shops: shops || [],
    allSubs: allSubs || [],
    owners: owners || [],
    thisMonthRevenue: (thisMonthSubs || []).reduce((s: number, x: any) => s + Number(x.amount), 0),
    lastMonthRevenue: (lastMonthSubs || []).reduce((s: number, x: any) => s + Number(x.amount), 0),
    totalProducts: totalProducts ?? 0,
    totalCustomers: totalCustomers ?? 0,
    salesToday: salesToday ?? 0,
    sales7d: sales7d ?? 0,
    cutoff14d,
    cutoff3d,
  }
}

function buildRevenueChart(subs: any[]) {
  const months: { month: string; revenue: number; count: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const label = d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
    const start = new Date(d.getFullYear(), d.getMonth(), 1)
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)
    const matching = subs.filter(s => {
      const c = new Date(s.created_at)
      return c >= start && c <= end && s.status === 'active'
    })
    months.push({
      month: label,
      revenue: matching.reduce((acc: number, s: any) => acc + Number(s.amount), 0),
      count: matching.length,
    })
  }
  return months
}

export default async function AdminDashboard({ params: { locale } }: { params: { locale: string } }) {
  const supabase = await createClient()
  const { shops, allSubs, owners, thisMonthRevenue, lastMonthRevenue, totalProducts, totalCustomers, salesToday, sales7d, cutoff14d, cutoff3d } = await getData(supabase)

  const ownersByShop = owners.reduce((acc: any, o: any) => { acc[o.shop_id] = o; return acc }, {})

  const totalRevenue = allSubs.reduce((s: number, x: any) => s + Number(x.amount), 0)
  const activeSubscriptions = shops.filter((s: any) => hasActiveSubscription(s.plan, s.plan_expires_at)).length
  const activeTrials = shops.filter((s: any) => {
    const days = getTrialDaysLeft(s.trial_ends_at)
    return !hasActiveSubscription(s.plan, s.plan_expires_at) && days >= 0
  }).length
  const expired = shops.filter((s: any) => {
    const days = getTrialDaysLeft(s.trial_ends_at)
    return !hasActiveSubscription(s.plan, s.plan_expires_at) && days < 0
  }).length
  const suspended = shops.filter((s: any) => s.is_active === false).length
  const newShopsThisMonth = shops.filter((s: any) => {
    return new Date(s.created_at) >= new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  }).length

  // Boutiques inactives (owner last_seen > 14 jours)
  const inactiveShops = shops.filter((s: any) => {
    const owner = ownersByShop[s.id]
    if (!owner?.last_seen) return true
    return new Date(owner.last_seen) < new Date(cutoff14d)
  })

  // Boutiques avec trial expirant dans 3 jours
  const expiringTrials = shops.filter((s: any) => {
    const days = getTrialDaysLeft(s.trial_ends_at)
    return !hasActiveSubscription(s.plan, s.plan_expires_at) && days >= 0 && days <= 3
  })

  const revenueGrowth = lastMonthRevenue > 0
    ? Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
    : thisMonthRevenue > 0 ? 100 : 0

  const chartData = buildRevenueChart(allSubs)
  const recentPayments = allSubs.slice(0, 10)

  const mrr = (['starter', 'pro', 'business'] as const).reduce((acc, planId) => {
    const count = shops.filter((s: any) => s.plan === planId && hasActiveSubscription(s.plan, s.plan_expires_at)).length
    return acc + count * PLANS[planId].price_monthly
  }, 0)
  const arr = mrr * 12

  const conversionRate = shops.length > 0 ? Math.round((activeSubscriptions / shops.length) * 100) : 0

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Command Center</h1>
          <p className="text-gray-400 text-sm mt-1">
            {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">StockShop Admin</p>
          <p className="text-xs text-stockshop-gold font-semibold">OWNER PANEL</p>
        </div>
      </div>

      {/* Alertes prioritaires */}
      {(inactiveShops.length > 0 || expiringTrials.length > 0) && (
        <div className="grid md:grid-cols-2 gap-3">
          {expiringTrials.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-amber-400" />
                <span className="text-sm font-semibold text-amber-400">{expiringTrials.length} trial(s) expirant dans 3 jours</span>
              </div>
              <div className="space-y-1">
                {expiringTrials.slice(0, 3).map((s: any) => (
                  <Link key={s.id} href={`/${locale}/admin/shops/${s.id}`} className="flex items-center justify-between hover:bg-amber-500/10 rounded px-2 py-1 transition-colors">
                    <span className="text-xs text-gray-300">{s.name}</span>
                    <span className="text-xs text-amber-400">{getTrialDaysLeft(s.trial_ends_at)}j restants →</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {inactiveShops.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-red-400" />
                <span className="text-sm font-semibold text-red-400">{inactiveShops.length} boutique(s) inactives 14j+</span>
              </div>
              <div className="space-y-1">
                {inactiveShops.slice(0, 3).map((s: any) => (
                  <Link key={s.id} href={`/${locale}/admin/shops/${s.id}`} className="flex items-center justify-between hover:bg-red-500/10 rounded px-2 py-1 transition-colors">
                    <span className="text-xs text-gray-300">{s.name}</span>
                    <span className="text-xs text-red-400">Inactive →</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* KPI cards — finances */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Revenue total', value: formatNaira(totalRevenue), sub: 'All time', icon: DollarSign, color: 'text-green-400', bg: 'bg-green-400/10' },
          { label: 'MRR', value: formatNaira(mrr), sub: `ARR : ${formatNaira(arr)}`, icon: TrendingUp, color: 'text-blue-400', bg: 'bg-blue-400/10' },
          { label: 'Ce mois-ci', value: formatNaira(thisMonthRevenue), sub: revenueGrowth >= 0 ? `+${revenueGrowth}% vs mois dernier` : `${revenueGrowth}% vs mois dernier`, icon: ArrowUpRight, color: revenueGrowth >= 0 ? 'text-green-400' : 'text-red-400', bg: revenueGrowth >= 0 ? 'bg-green-400/10' : 'bg-red-400/10' },
          { label: 'Total boutiques', value: shops.length, sub: `+${newShopsThisMonth} ce mois`, icon: ShoppingBag, color: 'text-purple-400', bg: 'bg-purple-400/10' },
        ].map(({ label, value, sub, icon: Icon, color, bg }) => (
          <div key={label} className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <div className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${bg} mb-3`}>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <p className="text-xl font-bold text-white">{value}</p>
            <p className="text-gray-400 text-xs mt-0.5">{label}</p>
            <p className={`text-xs mt-1 ${color}`}>{sub}</p>
          </div>
        ))}
      </div>

      {/* KPI cards — activité produit */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Produits gérés', value: totalProducts.toLocaleString(), sub: 'Toutes boutiques', icon: Package, color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
          { label: 'Clients enregistrés', value: totalCustomers.toLocaleString(), sub: 'Toutes boutiques', icon: Users, color: 'text-violet-400', bg: 'bg-violet-400/10' },
          { label: 'Ventes aujourd\'hui', value: salesToday.toLocaleString(), sub: `${sales7d} sur 7 jours`, icon: Activity, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
          { label: 'Taux de conversion', value: `${conversionRate}%`, sub: `${activeSubscriptions} payants / ${shops.length} total`, icon: UserCheck, color: 'text-stockshop-gold', bg: 'bg-yellow-400/10' },
        ].map(({ label, value, sub, icon: Icon, color, bg }) => (
          <div key={label} className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <div className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${bg} mb-3`}>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <p className="text-xl font-bold text-white">{value}</p>
            <p className="text-gray-400 text-xs mt-0.5">{label}</p>
            <p className={`text-xs mt-1 ${color}`}>{sub}</p>
          </div>
        ))}
      </div>

      {/* Statut boutiques */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 text-center">
          <p className="text-3xl font-extrabold text-green-400">{activeSubscriptions}</p>
          <p className="text-xs text-gray-400 mt-1">Abonnés payants</p>
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 text-center">
          <p className="text-3xl font-extrabold text-amber-400">{activeTrials}</p>
          <p className="text-xs text-gray-400 mt-1">Trials actifs</p>
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 text-center">
          <p className="text-3xl font-extrabold text-red-400">{expired}</p>
          <p className="text-xs text-gray-400 mt-1">Expirés / à convertir</p>
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 text-center">
          <p className="text-3xl font-extrabold text-gray-500">{suspended}</p>
          <p className="text-xs text-gray-400 mt-1">Suspendus</p>
        </div>
      </div>

      {/* Plan breakdown + Graphique */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h2 className="font-semibold text-white text-sm mb-4">Répartition des plans</h2>
          <div className="space-y-3">
            {(['starter', 'pro', 'business'] as const).map(planId => {
              const count = shops.filter((s: any) => s.plan === planId && hasActiveSubscription(s.plan, s.plan_expires_at)).length
              const revenue = count * PLANS[planId].price_monthly
              const pct = activeSubscriptions > 0 ? Math.round((count / activeSubscriptions) * 100) : 0
              return (
                <div key={planId}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-gray-300 text-xs capitalize">{PLANS[planId].name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">{count} boutiques</span>
                      <span className="text-xs font-bold text-white">{formatNaira(revenue)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-5 pt-4 border-t border-gray-800">
            <p className="text-xs text-gray-400 mb-2">Conversion trial → payant</p>
            <p className="text-2xl font-bold text-stockshop-gold">{conversionRate}%</p>
            <p className="text-xs text-gray-500 mt-0.5">{activeSubscriptions} convertis sur {shops.length}</p>
          </div>
        </div>
        <div className="md:col-span-2 bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h2 className="font-semibold text-white text-sm mb-4">Revenue — 6 derniers mois</h2>
          <RevenueChart data={chartData} />
        </div>
      </div>

      {/* Paiements récents */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
          <h2 className="font-semibold text-white text-sm">Paiements récents</h2>
          <Link href={`/${locale}/admin/payments`} className="text-xs text-blue-400 hover:underline">Voir tout →</Link>
        </div>
        <RecentPayments payments={recentPayments} shops={shops} />
      </div>
    </div>
  )
}
