'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { RotateCcw, Package, Users, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { formatNaira } from '@/lib/utils/currency'

interface Props {
  shopId: string
  shopName: string
}

export function ShopRestorePanel({ shopId, shopName }: Props) {
  const supabase = createClient() as any
  const { toast } = useToast()

  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [deletedProducts, setDeletedProducts] = useState<any[]>([])
  const [archivedProducts, setArchivedProducts] = useState<any[]>([])
  const [deletedCustomers, setDeletedCustomers] = useState<any[]>([])
  const [restoring, setRestoring] = useState<string | null>(null)

  const loadData = async () => {
    setLoading(true)
    const [{ data: delLog }, { data: archived }, { data: softCustomers }] = await Promise.all([
      // Produits supprimés définitivement (dans le journal)
      supabase
        .from('deleted_records_log')
        .select('id, deleted_at, deleted_by, record_data')
        .eq('shop_id', shopId)
        .eq('table_name', 'products')
        .order('deleted_at', { ascending: false }),

      // Produits archivés (is_active = false)
      supabase
        .from('products')
        .select('id, name, selling_price, quantity, unit, updated_at')
        .eq('shop_id', shopId)
        .eq('is_active', false)
        .order('updated_at', { ascending: false }),

      // Clients soft-deleted (deleted_at non null)
      supabase
        .from('customers')
        .select('id, name, phone, total_debt, deleted_at')
        .eq('shop_id', shopId)
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false }),
    ])
    setDeletedProducts(delLog || [])
    setArchivedProducts(archived || [])
    setDeletedCustomers(softCustomers || [])
    setLoading(false)
  }

  const toggle = () => {
    if (!open) loadData()
    setOpen(v => !v)
  }

  const restoreProduct = async (logId: string) => {
    setRestoring(logId)
    const res = await fetch('/api/products/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ log_id: logId, shop_id: shopId }),
    })
    const json = await res.json()
    setRestoring(null)
    if (!res.ok) {
      toast({ title: json.error, variant: 'destructive' })
    } else {
      toast({ title: '✅ Produit restauré', variant: 'success' })
      loadData()
    }
  }

  const reactivateProduct = async (productId: string) => {
    setRestoring(productId)
    await supabase.from('products').update({ is_active: true }).eq('id', productId)
    setRestoring(null)
    toast({ title: '✅ Produit réactivé', variant: 'success' })
    loadData()
  }

  const restoreCustomer = async (customerId: string) => {
    setRestoring(customerId)
    await supabase.from('customers').update({ deleted_at: null }).eq('id', customerId)
    setRestoring(null)
    toast({ title: '✅ Client restauré', variant: 'success' })
    loadData()
  }

  const total = deletedProducts.length + archivedProducts.length + deletedCustomers.length
  const hasData = total > 0

  return (
    <div className="mt-3 border border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={toggle}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-800/60 hover:bg-gray-800 transition-colors text-sm"
      >
        <span className="flex items-center gap-2 text-gray-300 font-medium">
          <RotateCcw className="h-3.5 w-3.5 text-amber-400" />
          Restauration des données
          {hasData && !loading && (
            <span className="bg-amber-500/20 text-amber-400 text-xs px-1.5 py-0.5 rounded">{total}</span>
          )}
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5 text-gray-500" /> : <ChevronDown className="h-3.5 w-3.5 text-gray-500" />}
      </button>

      {open && (
        <div className="p-4 space-y-4 bg-gray-900/40">
          {loading && <p className="text-xs text-gray-500 text-center py-2">Chargement…</p>}

          {!loading && !hasData && (
            <p className="text-xs text-gray-500 text-center py-2">
              ✅ Aucune donnée supprimée pour cette boutique.
            </p>
          )}

          {/* Produits supprimés définitivement */}
          {deletedProducts.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-red-400 uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3" />
                Produits supprimés définitivement ({deletedProducts.length})
              </p>
              {deletedProducts.map(entry => (
                <div key={entry.id} className="flex items-center justify-between gap-3 bg-gray-800 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-white font-medium truncate">{entry.record_data?.name}</p>
                    <p className="text-xs text-gray-500">
                      Supprimé le {new Date(entry.deleted_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      {' · '}{entry.record_data?.selling_price ? `${formatNaira(entry.record_data.selling_price)}` : ''}
                      {' · '}{entry.record_data?.quantity ?? 0} {entry.record_data?.unit || ''}
                    </p>
                  </div>
                  <Button
                    size="sm" variant="outline"
                    className="h-7 gap-1 text-xs border-green-700 text-green-400 hover:bg-green-900/30 shrink-0"
                    disabled={restoring === entry.id}
                    onClick={() => restoreProduct(entry.id)}
                  >
                    <RotateCcw className={`h-3 w-3 ${restoring === entry.id ? 'animate-spin' : ''}`} />
                    Restaurer
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Produits archivés */}
          {archivedProducts.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <Package className="h-3 w-3" />
                Produits archivés ({archivedProducts.length})
              </p>
              {archivedProducts.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-3 bg-gray-800 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-white font-medium truncate">{p.name}</p>
                    <p className="text-xs text-gray-500">{p.quantity} {p.unit} · {formatNaira(p.selling_price)}</p>
                  </div>
                  <Button
                    size="sm" variant="outline"
                    className="h-7 gap-1 text-xs border-green-700 text-green-400 hover:bg-green-900/30 shrink-0"
                    disabled={restoring === p.id}
                    onClick={() => reactivateProduct(p.id)}
                  >
                    <RotateCcw className={`h-3 w-3 ${restoring === p.id ? 'animate-spin' : ''}`} />
                    Réactiver
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Clients soft-deleted */}
          {deletedCustomers.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider flex items-center gap-1.5">
                <Users className="h-3 w-3" />
                Clients supprimés ({deletedCustomers.length})
              </p>
              {deletedCustomers.map(c => (
                <div key={c.id} className="flex items-center justify-between gap-3 bg-gray-800 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-white font-medium truncate">{c.name}</p>
                    <p className="text-xs text-gray-500">
                      {c.phone || 'Pas de téléphone'}
                      {c.total_debt > 0 && ` · Dette : ${formatNaira(c.total_debt)}`}
                      {' · Supprimé le '}{new Date(c.deleted_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                    </p>
                  </div>
                  <Button
                    size="sm" variant="outline"
                    className="h-7 gap-1 text-xs border-green-700 text-green-400 hover:bg-green-900/30 shrink-0"
                    disabled={restoring === c.id}
                    onClick={() => restoreCustomer(c.id)}
                  >
                    <RotateCcw className={`h-3 w-3 ${restoring === c.id ? 'animate-spin' : ''}`} />
                    Restaurer
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
