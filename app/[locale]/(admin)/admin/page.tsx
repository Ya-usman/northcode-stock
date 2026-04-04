import { createClient } from '@/lib/supabase/server'
import { getPlan, getTrialDaysLeft, hasActiveSubscription } from '@/lib/saas/plans'
import { formatNaira } from '@/lib/utils/currency'
import { Users, ShoppingBag, TrendingUp, AlertTriangle, DollarSign } from 'lucide-react'
import { AdminShopsTable } from '@/components/admin/shops-table'

async function getAdminData(supabase: any) {
  const [{ data: shops }, { data: subs }, { data: profiles }] = await Promise.all([
    supabase
      .from('shops')
      .select('id, name, city, plan, trial_ends_at, plan_expires_at, created_at, whatsapp')
      .order('created_at', { ascending: false }),
    supabase
      .from('subscriptions')
      .select('id, shop_id, plan, amount, status, paystack_reference, starts_at, expires_at, created_at')
      .order('created_at', { ascending: false }),
    supabase
      .from('profiles')
      .select('id, full_name, shop_id, role, is_active, last_seen')
      .eq('role', 'owner'),
  ])
  return { shops: shops || [], subs: subs || [], owners: profiles || [] }
}

export default async function AdminPage({ params: { locale } }: { params: { locale: string } }) {
  const supabase = await createClient()
  const { shops, subs, owners } = await getAdminData(supabase)

  // Compute stats
  const activeSubscriptions = shops.filter((s: any) => hasActiveSubscription(s.plan, s.plan_expires_at)).length
  const activeTrials = shops.filter((s: any) => {
    const days = getTrialDaysLeft(s.trial_ends_at)
    return !hasActiveSubscription(s.plan, s.plan_expires_at) && days >= 0
  }).length
  const expired = shops.filter((s: any) => {
    const days = getTrialDaysLeft(s.trial_ends_at)
    return !hasActiveSubscription(s.plan, s.plan_expires_at) && days < 0
  }).length
  const mrr = subs
    .filter((s: any) => s.status === 'active')
    .reduce((acc: number, s: any) => acc + Number(s.amount), 0)

  // Enrich shops with owner info and subscription history
  const ownersByShop = owners.reduce((acc: any, o: any) => { acc[o.shop_id] = o; return acc }, {})
  const subsByShop = subs.reduce((acc: any, s: any) => {
    if (!acc[s.shop_id]) acc[s.shop_id] = []
    acc[s.shop_id].push(s)
    return acc
  }, {})

  const enrichedShops = shops.map((shop: any) => ({
    ...shop,
    owner: ownersByShop[shop.id] || null,
    subscriptions: subsByShop[shop.id] || [],
  }))

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Super Admin</h1>
        <p className="text-gray-400 text-sm mt-1">
          {shops.length} shops registered &bull; Last updated {new Date().toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total Shops', value: shops.length, icon: ShoppingBag, color: 'text-blue-400', bg: 'bg-blue-400/10' },
          { label: 'Subscribed', value: activeSubscriptions, icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-400/10' },
          { label: 'On Trial', value: activeTrials, icon: Users, color: 'text-amber-400', bg: 'bg-amber-400/10' },
          { label: 'Expired', value: expired, icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-400/10' },
          { label: 'Total Revenue', value: formatNaira(mrr), icon: DollarSign, color: 'text-purple-400', bg: 'bg-purple-400/10' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <div className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${bg} mb-3`}>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <p className="text-2xl font-bold text-white">{value}</p>
            <p className="text-gray-400 text-xs mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* MRR highlight */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2 bg-gradient-to-r from-northcode-blue to-[#1a4f9e] rounded-xl p-5">
          <p className="text-blue-200 text-xs font-medium uppercase tracking-wider mb-1">Monthly Recurring Revenue</p>
          <p className="text-4xl font-extrabold text-white">{formatNaira(mrr)}</p>
          <div className="flex gap-4 mt-3 text-sm">
            <span className="text-blue-200">{activeSubscriptions} subscribers</span>
            <span className="text-blue-300">·</span>
            <span className="text-blue-200">{activeTrials} trials</span>
            <span className="text-blue-300">·</span>
            <span className="text-red-300">{expired} expired</span>
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <p className="text-gray-400 text-xs font-medium uppercase tracking-wider mb-3">Plan breakdown</p>
          {(['starter', 'pro', 'business'] as const).map(planId => {
            const count = shops.filter((s: any) => s.plan === planId && hasActiveSubscription(s.plan, s.plan_expires_at)).length
            return (
              <div key={planId} className="flex justify-between items-center py-1.5 border-b border-gray-800 last:border-0">
                <span className="text-gray-300 text-sm capitalize">{getPlan(planId).name}</span>
                <span className="text-white font-bold text-sm">{count}</span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Shops management table (client component for actions) */}
      <AdminShopsTable shops={enrichedShops} locale={locale} />
    </div>
  )
}
