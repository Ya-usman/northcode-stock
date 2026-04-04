import { createClient } from '@/lib/supabase/server'
import { getPlan, getTrialDaysLeft, hasActiveSubscription } from '@/lib/saas/plans'
import { formatNaira } from '@/lib/utils/currency'
import { Users, ShoppingBag, TrendingUp, AlertTriangle } from 'lucide-react'

async function getAdminStats(supabase: any) {
  const [{ data: shops }, { data: profiles }, { data: subs }] = await Promise.all([
    supabase.from('shops').select('id, name, city, plan, trial_ends_at, plan_expires_at, created_at').order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, role').eq('role', 'owner'),
    supabase.from('subscriptions').select('amount, plan, status, created_at').eq('status', 'active'),
  ])

  return { shops: shops || [], profiles: profiles || [], subs: subs || [] }
}

export default async function AdminPage({ params: { locale } }: { params: { locale: string } }) {
  const supabase = await createClient()
  const { shops, subs } = await getAdminStats(supabase)

  const totalRevenue = subs.reduce((s: number, sub: any) => s + Number(sub.amount), 0)
  const activeSubscriptions = shops.filter((s: any) => hasActiveSubscription(s.plan, s.plan_expires_at)).length
  const activeTrials = shops.filter((s: any) => {
    const days = getTrialDaysLeft(s.trial_ends_at)
    return !hasActiveSubscription(s.plan, s.plan_expires_at) && days >= 0
  }).length
  const expired = shops.filter((s: any) => {
    const days = getTrialDaysLeft(s.trial_ends_at)
    return !hasActiveSubscription(s.plan, s.plan_expires_at) && days < 0
  }).length

  const STAT_CARDS = [
    { label: 'Total Shops', value: shops.length, icon: ShoppingBag, color: 'text-blue-400' },
    { label: 'Active Subscribers', value: activeSubscriptions, icon: TrendingUp, color: 'text-green-400' },
    { label: 'Active Trials', value: activeTrials, icon: Users, color: 'text-amber-400' },
    { label: 'Expired', value: expired, icon: AlertTriangle, color: 'text-red-400' },
  ]

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-gray-400 text-sm mt-1">Overview of all NorthCode shops</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {STAT_CARDS.map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-gray-400 text-xs font-medium uppercase tracking-wide">{label}</p>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <p className="text-3xl font-bold text-white">{value}</p>
          </div>
        ))}
      </div>

      {/* MRR card */}
      <div className="bg-gradient-to-r from-northcode-blue to-[#1a4f9e] rounded-xl p-5">
        <p className="text-blue-200 text-sm font-medium mb-1">Monthly Recurring Revenue (est.)</p>
        <p className="text-4xl font-extrabold text-white">{formatNaira(totalRevenue)}</p>
        <p className="text-blue-200 text-xs mt-1">{activeSubscriptions} active subscriptions</p>
      </div>

      {/* Shops table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800">
          <h2 className="font-semibold text-white">All Shops</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-5 py-3 text-gray-400 font-medium text-xs uppercase">Shop</th>
                <th className="text-left px-5 py-3 text-gray-400 font-medium text-xs uppercase">City</th>
                <th className="text-left px-5 py-3 text-gray-400 font-medium text-xs uppercase">Plan</th>
                <th className="text-left px-5 py-3 text-gray-400 font-medium text-xs uppercase">Status</th>
                <th className="text-left px-5 py-3 text-gray-400 font-medium text-xs uppercase">Joined</th>
              </tr>
            </thead>
            <tbody>
              {shops.map((shop: any) => {
                const subscribed = hasActiveSubscription(shop.plan, shop.plan_expires_at)
                const trialDays = getTrialDaysLeft(shop.trial_ends_at)
                const isActive = subscribed || trialDays >= 0

                return (
                  <tr key={shop.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="px-5 py-3 font-medium text-white">{shop.name}</td>
                    <td className="px-5 py-3 text-gray-400">{shop.city}</td>
                    <td className="px-5 py-3">
                      <span className="capitalize text-gray-300">
                        {getPlan(shop.plan).name}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {subscribed ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full">
                          ● Subscribed
                        </span>
                      ) : trialDays >= 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
                          ● Trial ({trialDays}d)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full">
                          ● Expired
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-xs">
                      {new Date(shop.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
