export const dynamic = 'force-dynamic'

import { createAdminClient } from '@/lib/supabase/server'
import { Package, AlertTriangle, TrendingDown, Store } from 'lucide-react'
import { CountryFilter } from '@/components/admin/country-filter'

export default async function AdminStockPage({
  searchParams,
}: {
  searchParams: { country?: string }
}) {
  const supabase = createAdminClient()
  const countryFilter = searchParams.country || 'all'

  const [{ data: allShops }, { data: products }] = await Promise.all([
    supabase.from('shops').select('id, name, city, country, currency').order('name'),
    supabase.from('products')
      .select('id, name, sku, quantity, unit, selling_price, buying_price, low_stock_threshold, is_active, shop_id')
      .eq('is_active', true)
      .order('name'),
  ])

  const shops = countryFilter === 'all'
    ? (allShops ?? [])
    : (allShops ?? []).filter((s: any) => (s.country || 'NG') === countryFilter)

  const shopIds = new Set(shops.map((s: any) => s.id))
  const shopMap = Object.fromEntries(shops.map((s: any) => [s.id, s]))

  const byShop: Record<string, any[]> = {}
  for (const p of (products ?? []) as any[]) {
    if (!shopIds.has(p.shop_id)) continue
    if (!byShop[p.shop_id]) byShop[p.shop_id] = []
    byShop[p.shop_id].push(p)
  }

  const totalProducts = (products ?? []).length
  const totalUnits = (products ?? []).reduce((s: number, p: any) => s + p.quantity, 0)
  const lowStock = (products ?? []).filter((p: any) => p.quantity > 0 && p.quantity <= (p.low_stock_threshold ?? 10)).length
  const outOfStock = (products ?? []).filter((p: any) => p.quantity === 0).length

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Stock</h1>
          <p className="text-muted-foreground text-sm mt-1">{shops.length} boutique(s) · {countryFilter === 'all' ? 'tous pays' : countryFilter === 'NG' ? '🇳🇬 Nigeria' : '🇨🇲 Cameroun'}</p>
        </div>
        <CountryFilter current={countryFilter} />
      </div>

      {/* KPIs cumulés */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Boutiques', value: (shops ?? []).length, color: 'text-purple-400', bg: 'bg-purple-400/10' },
          { label: 'Produits actifs', value: totalProducts, color: 'text-blue-400', bg: 'bg-blue-400/10' },
          { label: 'Unités totales', value: totalUnits.toLocaleString('fr-FR'), color: 'text-green-400', bg: 'bg-green-400/10' },
          { label: 'Stock faible', value: lowStock, color: 'text-amber-400', bg: 'bg-amber-400/10' },
          { label: 'Rupture', value: outOfStock, color: 'text-red-400', bg: 'bg-red-400/10' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className="bg-card rounded-xl border border-border shadow-sm p-4">
            <p className={`text-2xl font-extrabold ${color}`}>{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Par boutique */}
      {(shops ?? []).map((shop: any) => {
        const prods = byShop[shop.id] ?? []
        const flag = shop.country === 'CM' ? '🇨🇲' : '🇳🇬'

        if (prods.length === 0) return (
          <div key={shop.id} className="bg-card rounded-xl border border-border shadow-sm p-5">
            <div className="flex items-center gap-2 mb-2">
              <Store className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold text-foreground">{shop.name}</h2>
              {shop.city && <span className="text-xs text-muted-foreground">{flag} {shop.city}</span>}
            </div>
            <p className="text-xs text-muted-foreground italic">Aucun produit actif</p>
          </div>
        )

        const shopLow = prods.filter((p: any) => p.quantity > 0 && p.quantity <= (p.low_stock_threshold ?? 10)).length
        const shopOut = prods.filter((p: any) => p.quantity === 0).length

        return (
          <div key={shop.id} className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Store className="h-4 w-4 text-primary" />
                <h2 className="font-semibold text-foreground">{shop.name}</h2>
                {shop.city && <span className="text-xs text-muted-foreground">— {flag} {shop.city}</span>}
              </div>
              <div className="flex gap-4 text-xs">
                <span className="text-muted-foreground">{prods.length} produits</span>
                {shopLow > 0 && <span className="text-amber-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{shopLow} faible</span>}
                {shopOut > 0 && <span className="text-red-400 flex items-center gap-1"><TrendingDown className="h-3 w-3" />{shopOut} rupture</span>}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2 text-xs text-muted-foreground font-medium">Produit</th>
                    <th className="text-left px-4 py-2 text-xs text-muted-foreground font-medium">SKU</th>
                    <th className="text-right px-4 py-2 text-xs text-muted-foreground font-medium">Qté</th>
                    <th className="text-right px-4 py-2 text-xs text-muted-foreground font-medium">Prix vente</th>
                    <th className="text-center px-4 py-2 text-xs text-muted-foreground font-medium">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {prods.map((p: any) => {
                    const threshold = p.low_stock_threshold ?? 10
                    const isOut = p.quantity === 0
                    const isLow = !isOut && p.quantity <= threshold
                    return (
                      <tr key={p.id} className="border-b border-border/50 hover:bg-accent/30">
                        <td className="px-4 py-2.5 text-foreground font-medium">{p.name}</td>
                        <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">{p.sku ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right font-bold">
                          <span className={isOut ? 'text-red-400' : isLow ? 'text-amber-400' : 'text-green-400'}>
                            {p.quantity}
                          </span>
                          <span className="text-muted-foreground text-xs ml-1">{p.unit}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-foreground">{p.selling_price.toLocaleString('fr-FR')}</td>
                        <td className="px-4 py-2.5 text-center">
                          {isOut
                            ? <span className="text-xs bg-red-400/10 text-red-400 rounded-full px-2 py-0.5">Rupture</span>
                            : isLow
                            ? <span className="text-xs bg-amber-400/10 text-amber-400 rounded-full px-2 py-0.5">Faible</span>
                            : <span className="text-xs bg-green-400/10 text-green-400 rounded-full px-2 py-0.5">OK</span>
                          }
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
