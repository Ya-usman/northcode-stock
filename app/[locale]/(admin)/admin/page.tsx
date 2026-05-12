export const dynamic = 'force-dynamic'

import { createAdminClient } from '@/lib/supabase/server'
import { getTrialDaysLeft, hasActiveSubscription, PLANS } from '@/lib/saas/plans'
import { formatAdminRevenue, formatCurrency } from '@/lib/utils/currency'
import {
  TrendingUp, ShoppingBag, Users, AlertTriangle, DollarSign,
  ArrowUpRight, Package, Activity, Clock, UserCheck,
} from 'lucide-react'
import { COUNTRIES } from '@/lib/saas/countries'
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
    supabase.from('shops').select('id, name, plan, trial_ends_at, plan_expires_at, created_at, currency, country').order('created_at', { ascending: false }),
    supabase.from('subscriptions').select('id, shop_id, plan, amount, status, paystack_reference, starts_at, created_at').order('created_at', { ascending: false }),
    supabase.from('subscriptions').select('shop_id, amount').eq('status', 'active').gte('created_at', startOfMonth),
    supabase.from('subscriptions').select('shop_id, amount').eq('status', 'active').gte('created_at', startOfLastMonth).lte('created_at', endOfLastMonth),
    supabase.from('profiles').select('id, full_name, shop_id, last_seen, is_active').eq('role', 'owner'),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('customers').select('id', { count: 'exact', head: true }).is('deleted_at', null),
    supabase.from('sales').select('id', { count: 'exact', head: true }).gte('created_at', startToday),
    supabase.from('sales').select('id', { count: 'exact', head: true }).gte('created_at', start7d),
  ])

  return {
    shops: shops || [],
    allSubs: allSubs || [],
    owners: owners || [],
    thisMonthSubs: thisMonthSubs || [],
    lastMonthSubs: lastMonthSubs || [],
    totalProducts: totalProducts ?? 0,
    totalCustomers: totalCustomers ?? 0,
    salesToday: salesToday ?? 0,
    sales7d: sales7d ?? 0,
    cutoff14d,
  }
}

function splitRevenueByCurrency(subs: any[], shopCurrencyMap: Record<string, string>) {
  let ngn = 0
  let cfa = 0
  for (const s of subs) {
    const currency = shopCurrencyMap[s.shop_id] || '₦'
    if (currency.includes('CFA') || currency === 'FCFA') {
      cfa += Number(s.amount)
    } else {
      ngn += Number(s.amount)
    }
  }
  return { ngn, cfa }
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
  const supabase = await createAdminClient()
  const { shops, allSubs, owners, thisMonthSubs, lastMonthSubs, totalProducts, totalCustomers, salesToday, sales7d, cutoff14d } = await getData(supabase)

  const ownersByShop = owners.reduce((acc: any, o: any) => { acc[o.shop_id] = o; return acc }, {})
  const shopCurrencyMap: Record<string, string> = shops.reduce((acc: any, s: any) => { acc[s.id] = s.currency || '₦'; return acc }, {})

  const { ngn: totalNGN, cfa: totalCFA } = splitRevenueByCurrency(allSubs, shopCurrencyMap)
  const { ngn: thisMonthNGN, cfa: thisMonthCFA } = splitRevenueByCurrency(thisMonthSubs, shopCurrencyMap)
  const { ngn: lastMonthNGN, cfa: lastMonthCFA } = splitRevenueByCurrency(lastMonthSubs, shopCurrencyMap)

  const lastMonthTotal = lastMonthNGN + lastMonthCFA
  const thisMonthTotal = thisMonthNGN + thisMonthCFA
  const revenueGrowth = lastMonthTotal > 0
    ? Math.round(((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100)
    : thisMonthTotal > 0 ? 100 : 0

  const activeSubscriptions = shops.filter((s: any) => hasActiveSubscription(s.plan, s.plan_expires_at)).length
  const activeTrials = shops.filter((s: any) => {
    const days = getTrialDaysLeft(s.trial_ends_at)
    return !hasActiveSubscription(s.plan, s.plan_expires_at) && days >= 0
  }).length
  const expired = shops.filter((s: any) => {
    const days = getTrialDaysLeft(s.trial_ends_at)
    return !hasActiveSubscription(s.plan, s.plan_expires_at) && days < 0
  }).length
  const suspended = shops.filter((s: any) => ownersByShop[s.id]?.is_active === false).length
  const newShopsThisMonth = shops.filter((s: any) => {
    return new Date(s.created_at) >= new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  }).length

  const inactiveShops = shops.filter((s: any) => {
    const owner = ownersByShop[s.id]
    if (!owner?.last_seen) return true
    return new Date(owner.last_seen) < new Date(cutoff14d)
  })

  const expiringTrials = shops.filter((s: any) => {
    const days = getTrialDaysLeft(s.trial_ends_at)
    return !hasActiveSubscription(s.plan, s.plan_expires_at) && days >= 0 && days <= 3
  })

  const chartData = buildRevenueChart(allSubs)
  const recentPayments = allSubs.slice(0, 10)

  const conversionRate = shops.length > 0 ? Math.round((activeSubscriptions / shops.length) * 100) : 0

  // Count shops by country
  const countryCounts: Record<string, number> = {}
  for (const s of shops) {
    const c = s.country || 'NG'
    countryCounts[c] = (countryCounts[c] || 0) + 1
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Command Center</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">StockShop Admin</p>
          <div className="flex gap-1.5 mt-1 justify-end flex-wrap">
            {Object.entries(countryCounts).map(([country, count]) => {
              const cfg = COUNTRIES[country as keyof typeof COUNTRIES]
              return (
                <span key={country} className="text-[10px] bg-muted text-muted-foreground rounded-full px-2 py-0.5">
                  {cfg?.flag || '🌐'} {count}
                </span>
              )
            })}
          </div>
        </div>
      </div>

      {/* Alertes prioritaires */}
      {(inactiveShops.length > 0 || expiringTrials.length > 0) && (
        <div className="grid md:grid-cols-2 gap-3">
          {expiringTrials.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <Clock className="h-4 w-4 text-amber-400" />
                <span className="text-sm font-semibold text-amber-400">{expiringTrials.length} trial(s) expirant dans 3 jours</span>
              </div>
              <div className="space-y-1">
                {expiringTrials.slice(0, 3).map((s: any) => (
                  <Link key={s.id} href={`/${locale}/admin/shops/${s.id}`} className="flex items-center justify-between hover:bg-amber-500/10 rounded px-2 py-1 transition-colors">
                    <span className="text-xs text-foreground">{s.name}</span>
                    <span className="text-xs text-amber-400">{getTrialDaysLeft(s.trial_ends_at)}j restants →</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {inactiveShops.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl shadow-sm p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="h-4 w-4 text-red-400" />
                <span className="text-sm font-semibold text-red-400">{inactiveShops.length} boutique(s) inactives 14j+</span>
              </div>
              <div className="space-y-1">
                {inactiveShops.slice(0, 3).map((s: any) => (
                  <Link key={s.id} href={`/${locale}/admin/shops/${s.id}`} className="flex items-center justify-between hover:bg-red-500/10 rounded px-2 py-1 transition-colors">
                    <span className="text-xs text-foreground">{s.name}</span>
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
        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-green-400/10 mb-3">
            <DollarSign className="h-4 w-4 text-green-400" />
          </div>
          <p className="text-lg font-bold text-foreground leading-tight">{formatAdminRevenue(totalNGN, totalCFA)}</p>
          <p className="text-muted-foreground text-xs mt-0.5">Revenue total</p>
          <p className="text-xs mt-1 text-green-400">All time</p>
        </div>
        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-blue-400/10 mb-3">
            <TrendingUp className="h-4 w-4 text-blue-400" />
          </div>
          <p className="text-lg font-bold text-foreground leading-tight">{formatAdminRevenue(thisMonthNGN, thisMonthCFA)}</p>
          <p className="text-muted-foreground text-xs mt-0.5">Ce mois-ci</p>
          <p className={`text-xs mt-1 ${revenueGrowth >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {revenueGrowth >= 0 ? '+' : ''}{revenueGrowth}% vs mois dernier
          </p>
        </div>
        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-purple-400/10 mb-3">
            <ShoppingBag className="h-4 w-4 text-purple-400" />
          </div>
          <p className="text-xl font-bold text-foreground">{shops.length}</p>
          <p className="text-muted-foreground text-xs mt-0.5">Total boutiques</p>
          <p className="text-xs mt-1 text-purple-400">+{newShopsThisMonth} ce mois</p>
        </div>
        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <div className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-yellow-400/10 mb-3">
            <UserCheck className="h-4 w-4 text-stockshop-gold" />
          </div>
          <p className="text-xl font-bold text-foreground">{conversionRate}%</p>
          <p className="text-muted-foreground text-xs mt-0.5">Taux de conversion</p>
          <p className="text-xs mt-1 text-stockshop-gold">{activeSubscriptions} payants / {shops.length}</p>
        </div>
      </div>

      {/* KPI cards — activité produit */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Produits gérés', value: totalProducts.toLocaleString(), sub: 'Toutes boutiques · tous pays', icon: Package, color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
          { label: 'Clients enregistrés', value: totalCustomers.toLocaleString(), sub: 'Toutes boutiques · tous pays', icon: Users, color: 'text-violet-400', bg: 'bg-violet-400/10' },
          { label: "Ventes aujourd'hui", value: salesToday.toLocaleString(), sub: `${sales7d} sur 7 jours`, icon: Activity, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
          { label: 'Abonnés actifs', value: activeSubscriptions, sub: `${activeTrials} trials · ${expired} expirés`, icon: ArrowUpRight, color: 'text-blue-400', bg: 'bg-blue-400/10' },
        ].map(({ label, value, sub, icon: Icon, color, bg }) => (
          <div key={label} className="bg-card rounded-xl border border-border shadow-sm p-4">
            <div className={`inline-flex h-9 w-9 items-center justify-center rounded-lg ${bg} mb-3`}>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <p className="text-xl font-bold text-foreground">{value}</p>
            <p className="text-muted-foreground text-xs mt-0.5">{label}</p>
            <p className={`text-xs mt-1 ${color}`}>{sub}</p>
          </div>
        ))}
      </div>

      {/* Statut boutiques */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-card rounded-xl border border-border shadow-sm p-4 text-center">
          <p className="text-3xl font-extrabold text-green-400">{activeSubscriptions}</p>
          <p className="text-xs text-muted-foreground mt-1">Abonnés payants</p>
        </div>
        <div className="bg-card rounded-xl border border-border shadow-sm p-4 text-center">
          <p className="text-3xl font-extrabold text-amber-400">{activeTrials}</p>
          <p className="text-xs text-muted-foreground mt-1">Trials actifs</p>
        </div>
        <div className="bg-card rounded-xl border border-border shadow-sm p-4 text-center">
          <p className="text-3xl font-extrabold text-red-400">{expired}</p>
          <p className="text-xs text-muted-foreground mt-1">Expirés / à convertir</p>
        </div>
        <div className="bg-card rounded-xl border border-border shadow-sm p-4 text-center">
          <p className="text-3xl font-extrabold text-muted-foreground">{suspended}</p>
          <p className="text-xs text-muted-foreground mt-1">Suspendus</p>
        </div>
      </div>

      {/* Plan breakdown + Graphique */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-card rounded-xl border border-border shadow-sm p-5">
          <h2 className="font-semibold text-foreground text-sm mb-4">Répartition des plans</h2>
          <div className="space-y-3">
            {(['starter', 'pro', 'business'] as const).map(planId => {
              const planShops = shops.filter((s: any) => s.plan === planId && hasActiveSubscription(s.plan, s.plan_expires_at))
              const count = planShops.length
              const pct = activeSubscriptions > 0 ? Math.round((count / activeSubscriptions) * 100) : 0
              return (
                <div key={planId}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-foreground text-xs capitalize">{PLANS[planId].name}</span>
                    <span className="text-xs text-muted-foreground">{count} boutiques</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-5 pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground mb-2">Conversion trial → payant</p>
            <p className="text-2xl font-bold text-stockshop-gold">{conversionRate}%</p>
            <p className="text-xs text-muted-foreground mt-0.5">{activeSubscriptions} convertis sur {shops.length}</p>
          </div>
        </div>
        <div className="md:col-span-2 bg-card rounded-xl border border-border shadow-sm p-5">
          <h2 className="font-semibold text-foreground text-sm mb-1">Revenue — 6 derniers mois</h2>
          <p className="text-xs text-muted-foreground mb-3">Montants en devises locales (₦ + FCFA agrégés)</p>
          <RevenueChart data={chartData} />
        </div>
      </div>

      {/* Paiements récents */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-foreground text-sm">Paiements récents</h2>
          <Link href={`/${locale}/admin/payments`} className="text-xs text-blue-400 hover:underline">Voir tout →</Link>
        </div>
        <RecentPayments payments={recentPayments} shops={shops} />
      </div>
    </div>
  )
}
