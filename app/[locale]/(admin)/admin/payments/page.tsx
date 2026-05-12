import { createAdminClient } from '@/lib/supabase/server'
import { PLANS } from '@/lib/saas/plans'
import { formatCurrency, formatAdminRevenue } from '@/lib/utils/currency'
import { CountryFilter } from '@/components/admin/country-filter'

const PLAN_COLORS: Record<string, string> = {
  starter: 'text-blue-400 bg-blue-400/10',
  pro: 'text-purple-400 bg-purple-400/10',
  business: 'text-amber-400 bg-amber-400/10',
}

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: { country?: string }
}) {
  const supabase = await createAdminClient()

  const [{ data: subs }, { data: allShops }] = await Promise.all([
    supabase.from('subscriptions').select('*').order('created_at', { ascending: false }),
    supabase.from('shops').select('id, name, city, country, currency'),
  ])

  const countryFilter = searchParams.country || 'all'
  const shops = allShops || []
  const shopMap = shops.reduce((acc: any, s: any) => { acc[s.id] = s; return acc }, {})
  const filteredShopIds = countryFilter === 'all'
    ? null
    : new Set(shops.filter((s: any) => (s.country || 'NG') === countryFilter).map((s: any) => s.id))
  const payments = (subs || []).filter((p: any) => !filteredShopIds || filteredShopIds.has(p.shop_id))

  let totalNGN = 0, totalCFA = 0
  for (const p of payments) {
    const currency = shopMap[p.shop_id]?.currency || '₦'
    if (currency.includes('CFA') || currency === 'FCFA') totalCFA += Number(p.amount)
    else totalNGN += Number(p.amount)
  }
  const totalCount = payments.length

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Paiements</h1>
          <p className="text-muted-foreground text-sm mt-1">{payments.length} paiement(s) · {countryFilter === 'all' ? 'tous pays' : countryFilter === 'NG' ? '🇳🇬 Nigeria' : '🇨🇲 Cameroun'}</p>
        </div>
        <CountryFilter current={countryFilter} />
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-xl p-4 col-span-2 md:col-span-1">
          <p className="text-muted-foreground text-xs mb-1">Revenus total collectés</p>
          <p className="text-xl font-bold text-green-400">{formatAdminRevenue(totalNGN, totalCFA)}</p>
          {totalNGN > 0 && totalCFA > 0 && (
            <p className="text-xs text-muted-foreground mt-1">🇳🇬 ₦ + 🇨🇲 FCFA</p>
          )}
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-muted-foreground text-xs mb-1">Nombre de paiements</p>
          <p className="text-2xl font-bold text-foreground">{totalCount}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-muted-foreground text-xs mb-1">Boutiques distinctes</p>
          <p className="text-2xl font-bold text-foreground">
            {new Set(payments.map((p: any) => p.shop_id)).size}
          </p>
        </div>
      </div>

      {/* Payments table */}
      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase">Boutique</th>
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase">Plan</th>
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase">Montant</th>
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase">Statut</th>
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase">Référence</th>
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase">Date</th>
                <th className="text-left px-5 py-3 text-muted-foreground font-medium text-xs uppercase">Expiration</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-muted-foreground text-sm">
                    Aucun paiement
                  </td>
                </tr>
              )}
              {payments.map((p: any) => {
                const shop = shopMap[p.shop_id]
                const planLabel = PLANS[p.plan as keyof typeof PLANS]?.name || p.plan
                const colorClass = PLAN_COLORS[p.plan] || 'text-muted-foreground bg-muted'
                const isExpired = p.expires_at && new Date(p.expires_at) < new Date()
                const currency = shop?.currency || '₦'
                const flag = shop?.country === 'CM' ? '🇨🇲' : '🇳🇬'

                return (
                  <tr key={p.id} className="border-b border-border/50 hover:bg-accent/30 transition-colors">
                    <td className="px-5 py-3">
                      <p className="font-medium text-foreground">{shop?.name || '—'}</p>
                      <p className="text-xs text-muted-foreground">{flag} {shop?.city}</p>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${colorClass}`}>
                        {planLabel}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-bold text-green-400">
                      {formatCurrency(p.amount, currency)}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        p.status === 'active'
                          ? 'text-green-400 bg-green-400/10'
                          : 'text-muted-foreground bg-muted'
                      }`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs font-mono text-muted-foreground truncate max-w-[120px] block">
                        {p.paystack_reference || '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground text-xs">
                      {new Date(p.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-5 py-3">
                      {p.expires_at ? (
                        <span className={`text-xs ${isExpired ? 'text-red-400' : 'text-foreground'}`}>
                          {new Date(p.expires_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
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
