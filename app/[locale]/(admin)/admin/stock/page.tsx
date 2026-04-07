import { createAdminClient } from '@/lib/supabase/server'
import { Package, AlertTriangle, TrendingDown, Store } from 'lucide-react'

export default async function AdminStockPage() {
  const supabase = await createAdminClient()

  const [{ data: shops }, { data: products }] = await Promise.all([
    supabase.from('shops').select('id, name, city, country').order('name'),
    supabase.from('products')
      .select('id, name, sku, quantity, unit, selling_price, buying_price, low_stock_threshold, is_active, shop_id')
      .eq('is_active', true)
      .order('name'),
  ])

  const shopMap = Object.fromEntries((shops ?? []).map((s: any) => [s.id, s]))

  // Group products by shop
  const byShop: Record<string, any[]> = {}
  for (const p of (products ?? []) as any[]) {
    if (!byShop[p.shop_id]) byShop[p.shop_id] = []
    byShop[p.shop_id].push(p)
  }

  // Cumulated stats
  const totalProducts = (products ?? []).length
  const totalValue = (products ?? []).reduce((s: number, p: any) => s + p.quantity * p.selling_price, 0)
  const totalUnits = (products ?? []).reduce((s: number, p: any) => s + p.quantity, 0)
  const lowStock = (products ?? []).filter((p: any) => p.quantity > 0 && p.quantity <= (p.low_stock_threshold ?? 10)).length
  const outOfStock = (products ?? []).filter((p: any) => p.quantity === 0).length

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Stock — Toutes les boutiques</h1>
        <p className="text-gray-400 text-sm mt-1">Vue cumulée et détaillée par boutique</p>
      </div>

      {/* KPIs cumulés */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Boutiques', value: (shops ?? []).length, color: 'text-purple-400', bg: 'bg-purple-400/10' },
          { label: 'Produits actifs', value: totalProducts, color: 'text-blue-400', bg: 'bg-blue-400/10' },
          { label: 'Unités totales', value: totalUnits.toLocaleString('fr-FR'), color: 'text-green-400', bg: 'bg-green-400/10' },
          { label: 'Stock faible', value: lowStock, color: 'text-amber-400', bg: 'bg-amber-400/10' },
          { label: 'Rupture', value: outOfStock, color: 'text-red-400', bg: 'bg-red-400/10' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <p className={`text-2xl font-extrabold ${color}`}>{value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <p className="text-sm text-gray-400">Valeur totale du stock</p>
        <p className="text-3xl font-extrabold text-white mt-1">
          {totalValue.toLocaleString('fr-FR')} <span className="text-base font-normal text-gray-500">toutes devises</span>
        </p>
      </div>

      {/* Par boutique */}
      {(shops ?? []).map((shop: any) => {
        const prods = byShop[shop.id] ?? []
        if (prods.length === 0) return (
          <div key={shop.id} className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <div className="flex items-center gap-2 mb-2">
              <Store className="h-4 w-4 text-gray-500" />
              <h2 className="font-semibold text-white">{shop.name}</h2>
              {shop.city && <span className="text-xs text-gray-500">{shop.city}</span>}
            </div>
            <p className="text-xs text-gray-600">Aucun produit actif</p>
          </div>
        )

        const shopValue = prods.reduce((s: number, p: any) => s + p.quantity * p.selling_price, 0)
        const shopLow = prods.filter((p: any) => p.quantity > 0 && p.quantity <= (p.low_stock_threshold ?? 10)).length
        const shopOut = prods.filter((p: any) => p.quantity === 0).length

        return (
          <div key={shop.id} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Store className="h-4 w-4 text-northcode-blue" />
                <h2 className="font-semibold text-white">{shop.name}</h2>
                {shop.city && <span className="text-xs text-gray-500">— {shop.city}</span>}
                <span className="text-xs bg-gray-800 text-gray-400 rounded-full px-2 py-0.5">{shop.country === 'CM' ? '🇨🇲' : '🇳🇬'}</span>
              </div>
              <div className="flex gap-4 text-xs">
                <span className="text-gray-400">{prods.length} produits</span>
                <span className="text-white font-medium">{shopValue.toLocaleString('fr-FR')}</span>
                {shopLow > 0 && <span className="text-amber-400 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{shopLow} faible</span>}
                {shopOut > 0 && <span className="text-red-400 flex items-center gap-1"><TrendingDown className="h-3 w-3" />{shopOut} rupture</span>}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">Produit</th>
                    <th className="text-left px-4 py-2 text-xs text-gray-500 font-medium">SKU</th>
                    <th className="text-right px-4 py-2 text-xs text-gray-500 font-medium">Qté</th>
                    <th className="text-right px-4 py-2 text-xs text-gray-500 font-medium">Prix vente</th>
                    <th className="text-right px-4 py-2 text-xs text-gray-500 font-medium">Valeur</th>
                    <th className="text-center px-4 py-2 text-xs text-gray-500 font-medium">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {prods.map((p: any) => {
                    const threshold = p.low_stock_threshold ?? 10
                    const isOut = p.quantity === 0
                    const isLow = !isOut && p.quantity <= threshold
                    return (
                      <tr key={p.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="px-4 py-2.5 text-white font-medium">{p.name}</td>
                        <td className="px-4 py-2.5 text-gray-500 font-mono text-xs">{p.sku ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right font-bold">
                          <span className={isOut ? 'text-red-400' : isLow ? 'text-amber-400' : 'text-green-400'}>
                            {p.quantity}
                          </span>
                          <span className="text-gray-600 text-xs ml-1">{p.unit}</span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-300">{p.selling_price.toLocaleString('fr-FR')}</td>
                        <td className="px-4 py-2.5 text-right text-gray-300">{(p.quantity * p.selling_price).toLocaleString('fr-FR')}</td>
                        <td className="px-4 py-2.5 text-center">
                          {isOut
                            ? <span className="text-xs bg-red-900/50 text-red-400 rounded-full px-2 py-0.5">Rupture</span>
                            : isLow
                            ? <span className="text-xs bg-amber-900/50 text-amber-400 rounded-full px-2 py-0.5">Faible</span>
                            : <span className="text-xs bg-green-900/50 text-green-400 rounded-full px-2 py-0.5">OK</span>
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
