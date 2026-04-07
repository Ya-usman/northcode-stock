'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Search, Store, ArrowLeftRight } from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { CrossShopProduct } from '@/lib/types/database'

const supabase = createClient()

interface CrossShopSearchProps {
  currentShopId: string
  onRequestTransfer?: (product: CrossShopProduct) => void
}

export function CrossShopSearch({ currentShopId, onRequestTransfer }: CrossShopSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CrossShopProduct[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const search = async () => {
    if (!query.trim()) return
    setLoading(true)
    setSearched(true)

    const { data } = await (supabase as any)
      .from('cross_shop_stock')
      .select('*')
      .neq('shop_id', currentShopId)
      .or(`name.ilike.%${query}%,sku.ilike.%${query}%`)
      .order('quantity', { ascending: false })
      .limit(20)

    setResults((data ?? []) as CrossShopProduct[])
    setLoading(false)
  }

  return (
    <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50 p-4 space-y-3">
      <div className="flex items-center gap-2 text-amber-700 text-sm font-medium">
        <Search className="h-4 w-4" />
        Produit introuvable dans cette boutique ? Chercher dans les autres boutiques
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          placeholder="Nom ou SKU du produit…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
        />
        <button
          onClick={search}
          disabled={loading}
          className="rounded-lg bg-amber-600 text-white px-4 py-2 text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
        >
          {loading ? '…' : 'Chercher'}
        </button>
      </div>

      {searched && results.length === 0 && !loading && (
        <p className="text-xs text-amber-600">Aucune boutique n'a ce produit en stock.</p>
      )}

      {results.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-amber-700 font-medium">{results.length} résultat{results.length !== 1 ? 's' : ''} dans d'autres boutiques :</p>
          {results.map(r => (
            <div
              key={`${r.shop_id}-${r.product_id}`}
              className="flex items-center justify-between rounded-lg bg-white border border-amber-100 px-3 py-2.5"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Store className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{r.name}</p>
                  <p className="text-xs text-muted-foreground">{r.shop_name} — {r.shop_city}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="text-right">
                  <p className={cn('text-sm font-bold', r.quantity <= 5 ? 'text-amber-600' : 'text-green-600')}>
                    {r.quantity} {r.unit}
                  </p>
                  <p className="text-xs text-muted-foreground">{r.selling_price.toLocaleString('fr-FR')}</p>
                </div>
                {onRequestTransfer && (
                  <button
                    onClick={() => onRequestTransfer(r)}
                    className="flex items-center gap-1 text-xs bg-northcode-blue text-white rounded-lg px-2.5 py-1.5 hover:bg-northcode-blue-light transition-colors"
                  >
                    <ArrowLeftRight className="h-3 w-3" /> Transférer
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
