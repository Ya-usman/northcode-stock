import { createClient } from '@/lib/supabase/server'
import { PLANS } from '@/lib/saas/plans'
import { formatNaira } from '@/lib/utils/currency'

const PLAN_COLORS: Record<string, string> = {
  starter: 'text-blue-400 bg-blue-400/10',
  pro: 'text-purple-400 bg-purple-400/10',
  business: 'text-amber-400 bg-amber-400/10',
}

export default async function AdminPaymentsPage() {
  const supabase = await createClient()

  const [{ data: subs }, { data: shops }] = await Promise.all([
    supabase.from('subscriptions').select('*').order('created_at', { ascending: false }),
    supabase.from('shops').select('id, name, city'),
  ])

  const payments = subs || []
  const shopMap = (shops || []).reduce((acc: any, s: any) => { acc[s.id] = s; return acc }, {})

  const totalRevenue = payments.reduce((s: number, p: any) => s + Number(p.amount), 0)
  const totalCount = payments.length

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Payments</h1>
        <p className="text-gray-400 text-sm mt-1">All subscription payments</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Total Collected</p>
          <p className="text-2xl font-bold text-green-400">{formatNaira(totalRevenue)}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Total Payments</p>
          <p className="text-2xl font-bold text-white">{totalCount}</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-400 text-xs mb-1">Average Payment</p>
          <p className="text-2xl font-bold text-white">
            {totalCount > 0 ? formatNaira(Math.round(totalRevenue / totalCount)) : '₦0'}
          </p>
        </div>
      </div>

      {/* Payments table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="text-left px-5 py-3 text-gray-400 font-medium text-xs uppercase">Shop</th>
                <th className="text-left px-5 py-3 text-gray-400 font-medium text-xs uppercase">Plan</th>
                <th className="text-left px-5 py-3 text-gray-400 font-medium text-xs uppercase">Amount</th>
                <th className="text-left px-5 py-3 text-gray-400 font-medium text-xs uppercase">Status</th>
                <th className="text-left px-5 py-3 text-gray-400 font-medium text-xs uppercase">Reference</th>
                <th className="text-left px-5 py-3 text-gray-400 font-medium text-xs uppercase">Date</th>
                <th className="text-left px-5 py-3 text-gray-400 font-medium text-xs uppercase">Expires</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-gray-600 text-sm">
                    No payments yet
                  </td>
                </tr>
              )}
              {payments.map((p: any) => {
                const shop = shopMap[p.shop_id]
                const planLabel = PLANS[p.plan as keyof typeof PLANS]?.name || p.plan
                const colorClass = PLAN_COLORS[p.plan] || 'text-gray-400 bg-gray-400/10'
                const isExpired = p.expires_at && new Date(p.expires_at) < new Date()

                return (
                  <tr key={p.id} className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                    <td className="px-5 py-3">
                      <p className="font-medium text-white">{shop?.name || '—'}</p>
                      <p className="text-xs text-gray-500">{shop?.city}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${colorClass}`}>
                        {planLabel}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-bold text-green-400">
                      {formatNaira(p.amount)}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        p.status === 'active'
                          ? 'text-green-400 bg-green-400/10'
                          : 'text-gray-400 bg-gray-400/10'
                      }`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs font-mono text-gray-500 truncate max-w-[120px] block">
                        {p.paystack_reference || '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-gray-400 text-xs">
                      {new Date(p.created_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-5 py-3">
                      {p.expires_at ? (
                        <span className={`text-xs ${isExpired ? 'text-red-400' : 'text-gray-300'}`}>
                          {new Date(p.expires_at).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      ) : (
                        <span className="text-gray-600 text-xs">—</span>
                      )}
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
