import { createAdminClient } from '@/lib/supabase/server'
import { getTrialDaysLeft, hasActiveSubscription } from '@/lib/saas/plans'
import { formatNaira } from '@/lib/utils/currency'
import { GrowthChart } from '@/components/admin/growth-chart'
import Link from 'next/link'
import { TrendingUp, Users, ShoppingBag, Activity } from 'lucide-react'

async function getData(supabase: any) {
  const [{ data: shops }, { data: subs }, { data: owners }] = await Promise.all([
    supabase.from('shops').select('id, name, plan, trial_ends_at, plan_expires_at, created_at, is_active').order('created_at', { ascending: true }),
    supabase.from('subscriptions').select('id, shop_id, plan, amount, status, created_at').order('created_at', { ascending: false }),
    supabase.from('profiles').select('id, shop_id, last_seen').eq('role', 'owner'),
  ])
  return { shops: shops || [], subs: subs || [], owners: owners || [] }
}

function buildMonthlyGrowth(shops: any[], subs: any[]) {
  const months: { month: string; newShops: number; newPayments: number; revenue: number }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const label = d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' })
    const start = new Date(d.getFullYear(), d.getMonth(), 1)
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)

    const newShops = shops.filter(s => {
      const c = new Date(s.created_at)
      return c >= start && c <= end
    }).length

    const monthSubs = subs.filter(s => {
      const c = new Date(s.created_at)
      return c >= start && c <= end && s.status === 'active'
    })

    months.push({
      month: label,
      newShops,
      newPayments: monthSubs.length,
      revenue: monthSubs.reduce((acc: number, s: any) => acc + Number(s.amount), 0),
    })
  }
  return months
}

function computeHealthScore(shop: any, owner: any) {
  const lastSeen = owner?.last_seen ? new Date(owner.last_seen) : null
  const daysSince = lastSeen ? Math.floor((Date.now() - lastSeen.getTime()) / 86400000) : 999
  let score = 0
  if (daysSince <= 7) score += 20
  if (score >= 0) score += 0 // placeholder: sales checked separately
  if (hasActiveSubscription(shop.plan, shop.plan_expires_at)) score += 30
  else if (getTrialDaysLeft(shop.trial_ends_at) >= 0) score += 10
  return Math.min(100, score)
}

export default async function AnalyticsPage({ params: { locale } }: { params: { locale: string } }) {
  const supabase = await createAdminClient()
  const { shops, subs, owners } = await getData(supabase)

  const ownersByShop = owners.reduce((acc: any, o: any) => { acc[o.shop_id] = o; return acc }, {})
  const monthlyData = buildMonthlyGrowth(shops, subs)

  const totalRevenue = subs.filter(s => s.status === 'active').reduce((acc: number, s: any) => acc + Number(s.amount), 0)
  const activeSubscriptions = shops.filter((s: any) => hasActiveSubscription(s.plan, s.plan_expires_at)).length
  const activeTrials = shops.filter((s: any) => !hasActiveSubscription(s.plan, s.plan_expires_at) && getTrialDaysLeft(s.trial_ends_at) >= 0).length
  const expired = shops.filter((s: any) => !hasActiveSubscription(s.plan, s.plan_expires_at) && getTrialDaysLeft(s.trial_ends_at) < 0).length

  // Cohortes de conversion (par mois d'inscription)
  const cohorts: { month: string; total: number; converted: number; rate: number }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const start = new Date(d.getFullYear(), d.getMonth(), 1)
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59)
    const monthShops = shops.filter(s => {
      const c = new Date(s.created_at)
      return c >= start && c <= end
    })
    const converted = monthShops.filter((s: any) => hasActiveSubscription(s.plan, s.plan_expires_at)).length
    cohorts.push({
      month: d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' }),
      total: monthShops.length,
      converted,
      rate: monthShops.length > 0 ? Math.round((converted / monthShops.length) * 100) : 0,
    })
  }

  // Top boutiques par santé (basé sur last_seen + plan)
  const shopsWithHealth = shops.map((s: any) => ({
    ...s,
    owner: ownersByShop[s.id],
    health: computeHealthScore(s, ownersByShop[s.id]),
    trialDays: getTrialDaysLeft(s.trial_ends_at),
    isPaid: hasActiveSubscription(s.plan, s.plan_expires_at),
  })).sort((a: any, b: any) => b.health - a.health)

  const atRisk = shopsWithHealth.filter((s: any) => s.health < 40 && !s.isPaid)

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Analytics & Croissance</h1>
        <p className="text-gray-400 text-sm mt-1">Vue sur 12 mois · {shops.length} boutiques total</p>
      </div>

      {/* Résumé global */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Revenue total', value: formatNaira(totalRevenue), icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-400/10' },
          { label: 'Payants', value: activeSubscriptions, icon: Users, color: 'text-blue-400', bg: 'bg-blue-400/10' },
          { label: 'En trial', value: activeTrials, icon: ShoppingBag, color: 'text-amber-400', bg: 'bg-amber-400/10' },
          { label: 'Expirés', value: expired, icon: Activity, color: 'text-red-400', bg: 'bg-red-400/10' },
        ].map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <div className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${bg} mb-2`}>
              <Icon className={`h-4 w-4 ${color}`} />
            </div>
            <p className="text-xl font-bold text-white">{value}</p>
            <p className="text-gray-400 text-xs mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Graphique de croissance 12 mois */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <h2 className="font-semibold text-white text-sm mb-4">Croissance — 12 derniers mois</h2>
        <GrowthChart data={monthlyData} />
      </div>

      {/* Cohortes de conversion */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <h2 className="font-semibold text-white text-sm mb-4">Taux de conversion par cohorte (mois d'inscription)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left py-2 px-3 text-gray-400 font-medium">Mois</th>
                <th className="text-right py-2 px-3 text-gray-400 font-medium">Inscriptions</th>
                <th className="text-right py-2 px-3 text-gray-400 font-medium">Convertis</th>
                <th className="text-right py-2 px-3 text-gray-400 font-medium">Taux</th>
                <th className="py-2 px-3 text-gray-400 font-medium">Progression</th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map(c => (
                <tr key={c.month} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                  <td className="py-2 px-3 text-gray-300 font-medium capitalize">{c.month}</td>
                  <td className="py-2 px-3 text-right text-gray-300">{c.total}</td>
                  <td className="py-2 px-3 text-right text-green-400">{c.converted}</td>
                  <td className={`py-2 px-3 text-right font-bold ${c.rate >= 30 ? 'text-green-400' : c.rate >= 10 ? 'text-amber-400' : 'text-red-400'}`}>
                    {c.rate}%
                  </td>
                  <td className="py-2 px-3">
                    <div className="h-1.5 bg-gray-800 rounded-full w-24 overflow-hidden">
                      <div className={`h-full rounded-full ${c.rate >= 30 ? 'bg-green-500' : c.rate >= 10 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${c.rate}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Boutiques à risque */}
      {atRisk.length > 0 && (
        <div className="bg-gray-900 rounded-xl border border-red-800/40 p-5">
          <h2 className="font-semibold text-white text-sm mb-1">🔴 Boutiques à risque de churn ({atRisk.length})</h2>
          <p className="text-xs text-gray-500 mb-4">Score santé {"<"} 40 · pas d'abonnement actif</p>
          <div className="space-y-2">
            {atRisk.slice(0, 10).map((s: any) => (
              <Link
                key={s.id}
                href={`/${locale}/admin/shops/${s.id}`}
                className="flex items-center justify-between bg-gray-800 hover:bg-gray-750 rounded-lg px-3 py-2.5 transition-colors group"
              >
                <div>
                  <p className="text-sm text-white font-medium group-hover:text-blue-400 transition-colors">{s.name}</p>
                  <p className="text-xs text-gray-500">
                    {s.isPaid ? 'Payant' : s.trialDays >= 0 ? `Trial : ${s.trialDays}j restants` : `Expiré depuis ${Math.abs(s.trialDays)}j`}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div>
                    <div className="h-1.5 bg-gray-700 rounded-full w-16 overflow-hidden">
                      <div className="h-full bg-red-500 rounded-full" style={{ width: `${s.health}%` }} />
                    </div>
                    <p className="text-xs text-red-400 text-right mt-0.5">{s.health}/100</p>
                  </div>
                  <span className="text-xs text-gray-500 group-hover:text-blue-400">Inspecter →</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Toutes les boutiques — classement santé */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-800">
          <h2 className="font-semibold text-white text-sm">Classement santé des boutiques</h2>
        </div>
        <div className="divide-y divide-gray-800/50">
          {shopsWithHealth.slice(0, 20).map((s: any) => {
            const hColor = s.health >= 70 ? 'bg-green-400' : s.health >= 40 ? 'bg-amber-400' : 'bg-red-400'
            const hText = s.health >= 70 ? 'text-green-400' : s.health >= 40 ? 'text-amber-400' : 'text-red-400'
            return (
              <Link
                key={s.id}
                href={`/${locale}/admin/shops/${s.id}`}
                className="flex items-center justify-between px-5 py-3 hover:bg-gray-800/40 transition-colors group"
              >
                <div>
                  <p className="text-sm text-white group-hover:text-blue-400 transition-colors">{s.name}</p>
                  <p className="text-xs text-gray-500">
                    {s.isPaid ? '✅ Payant' : s.trialDays >= 0 ? `🟡 Trial ${s.trialDays}j` : '🔴 Expiré'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="h-1.5 bg-gray-800 rounded-full w-20 overflow-hidden">
                    <div className={`h-full ${hColor} rounded-full`} style={{ width: `${s.health}%` }} />
                  </div>
                  <span className={`text-xs font-bold w-10 text-right ${hText}`}>{s.health}/100</span>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
