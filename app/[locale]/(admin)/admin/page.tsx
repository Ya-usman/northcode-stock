import { createClient } from '@/lib/supabase/server'
import { getTrialDaysLeft, hasActiveSubscription, PLANS } from '@/lib/saas/plans'
import { formatNaira } from '@/lib/utils/currency'
import { TrendingUp, ShoppingBag, Users, AlertTriangle, DollarSign, ArrowUpRight } from 'lucide-react'
import { RevenueChart } from '@/components/admin/revenue-chart'
import { RecentPayments } from '@/components/admin/recent-payments'

async function getData(supabase: any) {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString()

  const [{ data: shops }, { data: allSubs }, { data: thisMonthSubs }, { data: lastMonthSubs }] = await Promise.all([
    supabase.from('shops').select('id, plan, trial_ends_at, plan_expires_at, created_at').order('created_at', { ascending: false }),
    supabase.from('subscriptions').select('id, shop_id, plan, amount, status, paystack_reference, starts_at, created_at').order('created_at', { ascending: false }),
    supabase.from('subscriptions').select('amount').eq('status', 'active').gte('created_at', startOfMonth),
    supabase.from('subscriptions').select('amount').eq('status', 'active').gte('created_at', startOfLastMonth).lte('created_at', endOfLastMonth),
  ])

  return {
    shops: shops || [],
    allSubs: allSubs || [],
    thisMonthRevenue: (thisMonthSubs || []).reduce((s: number, x: any) => s + Number(x.amount), 0),
    lastMonthRevenue: (lastMonthSubs || []).reduce((s: number, x: any) => s + Number(x.amount), 0),
  }
}

function buildRevenueChart(subs: any[]) {
  // Last 6 months
  const months: { month: string; revenue: number; count: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const label = d.toLocaleDateString('en-NG', { month: 'short', year: '2-digit' })
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
  const { shops, allSubs, thisMonthRevenue, lastMonthRevenue } = await getData(supabase)

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
  const newShopsThisMonth = shops.filter((s: any) => {
    return new Date(s.created_at) >= new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  }).length

  const revenueGrowth = lastMonthRevenue > 0
    ? Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100)
    : thisMonthRevenue > 0 ? 100 : 0

  const chartData = buildRevenueChart(allSubs)
  const recentPayments = allSubs.slice(0, 10)

  // MRR = active subscriptions × average plan price
  const mrr = (['starter', 'pro', 'business'] as const).reduce((acc, planId) => {
    const count = shops.filter((s: any) => s.plan === planId && hasActiveSubscription(s.plan, s.plan_expires_at)).length
    return acc + count * PLANS[planId].price_monthly
  }, 0)

  const arr = mrr * 12

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Business Dashboard</h1>
        <p className="text-gray-400 text-sm mt-1">
          {new Date().toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: 'Total Revenue',
            value: formatNaira(totalRevenue),
            sub: 'All time',
            icon: DollarSign,
            color: 'text-green-400',
            bg: 'bg-green-400/10',
          },
          {
            label: 'MRR',
            value: formatNaira(mrr),
            sub: `ARR: ${formatNaira(arr)}`,
            icon: TrendingUp,
            color: 'text-blue-400',
            bg: 'bg-blue-400/10',
          },
          {
            label: 'This Month',
            value: formatNaira(thisMonthRevenue),
            sub: revenueGrowth >= 0 ? `+${revenueGrowth}% vs last month` : `${revenueGrowth}% vs last month`,
            icon: ArrowUpRight,
            color: revenueGrowth >= 0 ? 'text-green-400' : 'text-red-400',
            bg: revenueGrowth >= 0 ? 'bg-green-400/10' : 'bg-red-400/10',
          },
          {
            label: 'Total Shops',
            value: shops.length,
            sub: `+${newShopsThisMonth} this month`,
            icon: ShoppingBag,
            color: 'text-purple-400',
            bg: 'bg-purple-400/10',
          },
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

      {/* Shop status breakdown */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 text-center">
          <p className="text-3xl font-extrabold text-green-400">{activeSubscriptions}</p>
          <p className="text-xs text-gray-400 mt-1">Paying subscribers</p>
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 text-center">
          <p className="text-3xl font-extrabold text-amber-400">{activeTrials}</p>
          <p className="text-xs text-gray-400 mt-1">Active trials</p>
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 text-center">
          <p className="text-3xl font-extrabold text-red-400">{expired}</p>
          <p className="text-xs text-gray-400 mt-1">Expired / to convert</p>
        </div>
      </div>

      {/* Plan breakdown + Revenue chart */}
      <div className="grid md:grid-cols-3 gap-4">
        {/* Plan breakdown */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h2 className="font-semibold text-white text-sm mb-4">Plan Breakdown</h2>
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
                      <span className="text-xs text-gray-500">{count} shops</span>
                      <span className="text-xs font-bold text-white">{formatNaira(revenue)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-northcode-blue rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Trial conversion rate */}
          <div className="mt-5 pt-4 border-t border-gray-800">
            <p className="text-xs text-gray-400 mb-2">Trial → Paid conversion</p>
            {(() => {
              const totalTrialsEver = shops.filter((s: any) => s.plan !== null).length
              const converted = activeSubscriptions
              const rate = totalTrialsEver > 0 ? Math.round((converted / totalTrialsEver) * 100) : 0
              return (
                <div>
                  <p className="text-2xl font-bold text-northcode-gold">{rate}%</p>
                  <p className="text-xs text-gray-500 mt-0.5">{converted} converted out of {totalTrialsEver}</p>
                </div>
              )
            })()}
          </div>
        </div>

        {/* Revenue chart */}
        <div className="md:col-span-2 bg-gray-900 rounded-xl border border-gray-800 p-5">
          <h2 className="font-semibold text-white text-sm mb-4">Revenue — Last 6 Months</h2>
          <RevenueChart data={chartData} />
        </div>
      </div>

      {/* Recent payments */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800">
          <h2 className="font-semibold text-white text-sm">Recent Payments</h2>
        </div>
        <RecentPayments payments={recentPayments} shops={shops} />
      </div>
    </div>
  )
}
