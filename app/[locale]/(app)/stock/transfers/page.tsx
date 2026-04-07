'use client'

import { useState, useEffect } from 'react'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import { ArrowLeftRight, Plus, CheckCircle2, XCircle, Truck } from 'lucide-react'
import type { Product } from '@/lib/types/database'
import { CrossShopSearch } from '@/components/stock/cross-shop-search'

const supabase = createClient()

const STATUS_LABELS: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'default' }> = {
  pending:    { label: 'En attente',    variant: 'warning' },
  in_transit: { label: 'En transit',   variant: 'default' },
  received:   { label: 'Reçu',         variant: 'success' },
  cancelled:  { label: 'Annulé',       variant: 'danger'  },
}

export default function TransfersPage() {
  const { activeShop, userShops, profile, roleInActiveShop } = useAuthContext()
  const { toast } = useToast()

  const [transfers, setTransfers] = useState<any[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [creating, setCreating] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [form, setForm] = useState({ to_shop_id: '', product_id: '', quantity: 1, notes: '', bordereau_ref: '' })
  const [submitting, setSubmitting] = useState(false)

  const otherShops = userShops.filter(s => s.id !== activeShop?.id)
  const canManage = roleInActiveShop === 'owner' || roleInActiveShop === 'stock_manager'

  useEffect(() => {
    if (!activeShop?.id) return
    setLoadingData(true)

    Promise.all([
      supabase
        .from('stock_transfers')
        .select('*, from_shop:from_shop_id(name), to_shop:to_shop_id(name), product:product_id(name, unit)')
        .or(`from_shop_id.eq.${activeShop.id},to_shop_id.eq.${activeShop.id}`)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('products')
        .select('id, name, unit, quantity')
        .eq('shop_id', activeShop.id)
        .eq('is_active', true)
        .order('name'),
    ]).then(([{ data: t }, { data: p }]) => {
      setTransfers(t ?? [])
      setProducts((p ?? []) as Product[])
      setLoadingData(false)
    })
  }, [activeShop?.id])

  const handleCreate = async () => {
    if (!form.to_shop_id || !form.product_id || form.quantity < 1 || !activeShop) return
    setSubmitting(true)
    try {
      const product = products.find(p => p.id === form.product_id)
      if (!product) throw new Error('Produit introuvable')
      if (product.quantity < form.quantity) throw new Error(`Stock insuffisant (${product.quantity} dispo)`)

      const { error } = await (supabase as any).from('stock_transfers').insert({
        from_shop_id: activeShop.id,
        to_shop_id: form.to_shop_id,
        product_id: form.product_id,
        product_name: product.name,
        quantity: form.quantity,
        unit_cost: product.buying_price ?? 0,
        notes: form.notes || null,
        bordereau_ref: form.bordereau_ref || null,
        initiated_by: profile?.id ?? null,
        status: 'pending',
      })

      if (error) throw error

      toast({ title: 'Transfert créé !', description: 'En attente de confirmation.', variant: 'success' })
      setCreating(false)
      setForm({ to_shop_id: '', product_id: '', quantity: 1, notes: '', bordereau_ref: '' })
      // Refresh
      const { data: t } = await supabase
        .from('stock_transfers')
        .select('*, from_shop:from_shop_id(name), to_shop:to_shop_id(name), product:product_id(name, unit)')
        .or(`from_shop_id.eq.${activeShop.id},to_shop_id.eq.${activeShop.id}`)
        .order('created_at', { ascending: false })
        .limit(50)
      setTransfers(t ?? [])
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  const updateStatus = async (id: string, status: 'received' | 'cancelled') => {
    const { error } = await (supabase as any)
      .from('stock_transfers')
      .update({ status, received_by: status === 'received' ? profile?.id ?? null : undefined })
      .eq('id', id)

    if (error) {
      toast({ title: error.message, variant: 'destructive' })
      return
    }
    toast({
      title: status === 'received' ? 'Stock transféré !' : 'Transfert annulé',
      variant: status === 'received' ? 'success' : 'destructive',
    })
    setTransfers(prev => prev.map(t => t.id === id ? { ...t, status } : t))
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-bold text-lg">Transferts de stock</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Boutique active : <span className="font-medium text-gray-900">{activeShop?.name}</span>
            </p>
          </div>
          {canManage && otherShops.length > 0 && (
            <Button onClick={() => setCreating(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              Nouveau transfert
            </Button>
          )}
        </div>
        {otherShops.length === 0 && (
          <p className="mt-3 text-sm text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
            Vous devez avoir au moins 2 boutiques pour effectuer des transferts.
          </p>
        )}
      </div>

      {/* Create form */}
      {creating && (
        <div className="rounded-xl border bg-white p-5 shadow-sm space-y-4">
          <h2 className="font-semibold">Nouveau transfert depuis <span className="text-northcode-blue">{activeShop?.name}</span></h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Boutique destination *</label>
              <select
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-northcode-blue"
                value={form.to_shop_id}
                onChange={e => setForm(f => ({ ...f, to_shop_id: e.target.value }))}
              >
                <option value="">Choisir une boutique</option>
                {otherShops.map(s => (
                  <option key={s.id} value={s.id}>{s.name} — {s.city}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Produit *</label>
              <select
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-northcode-blue"
                value={form.product_id}
                onChange={e => setForm(f => ({ ...f, product_id: e.target.value }))}
              >
                <option value="">Choisir un produit</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>{p.name} (stock: {p.quantity} {p.unit})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Quantité *</label>
              <input
                type="number"
                min={1}
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-northcode-blue"
                value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: parseInt(e.target.value) || 1 }))}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">N° Bordereau</label>
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-northcode-blue"
                placeholder="Ex: BL-2024-001"
                value={form.bordereau_ref}
                onChange={e => setForm(f => ({ ...f, bordereau_ref: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1">Notes</label>
              <input
                className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-northcode-blue"
                placeholder="Optionnel"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleCreate} loading={submitting} disabled={!form.to_shop_id || !form.product_id}>
              Envoyer
            </Button>
            <Button variant="outline" onClick={() => setCreating(false)}>Annuler</Button>
          </div>
        </div>
      )}

      {/* Transfers list */}
      <div className="space-y-3">
        {loadingData ? (
          <div className="rounded-xl border bg-white p-8 text-center text-sm text-muted-foreground">Chargement…</div>
        ) : transfers.length === 0 ? (
          <div className="rounded-xl border bg-white p-8 text-center">
            <ArrowLeftRight className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium text-gray-900">Aucun transfert</p>
            <p className="text-sm text-muted-foreground mt-1">Les transferts inter-boutiques apparaîtront ici.</p>
          </div>
        ) : transfers.map(t => {
          const isOutgoing = t.from_shop_id === activeShop?.id
          const status = STATUS_LABELS[t.status] ?? STATUS_LABELS.pending
          const canReceive = !isOutgoing && t.status === 'pending' && canManage
          const canCancel = isOutgoing && t.status === 'pending' && canManage

          return (
            <div key={t.id} className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-full flex-shrink-0 ${isOutgoing ? 'bg-orange-50' : 'bg-green-50'}`}>
                    <Truck className={`h-4 w-4 ${isOutgoing ? 'text-orange-500' : 'text-green-600'}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      {t.transfer_number && (
                        <span className="font-mono text-[10px] text-northcode-blue bg-blue-50 px-1.5 py-0.5 rounded">
                          {t.transfer_number}
                        </span>
                      )}
                      {t.bordereau_ref && (
                        <span className="font-mono text-[10px] text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded">
                          BL: {t.bordereau_ref}
                        </span>
                      )}
                    </div>
                    <p className="font-medium text-sm text-gray-900">
                      {t.product?.name ?? t.product_name}
                      <span className="text-muted-foreground font-normal"> × {t.quantity} {t.product?.unit ?? ''}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {isOutgoing
                        ? `→ ${t.to_shop?.name ?? '?'}`
                        : `← ${t.from_shop?.name ?? '?'}`}
                      {' · '}
                      {new Date(t.created_at).toLocaleDateString('fr-FR')}
                    </p>
                    {t.notes && <p className="text-xs text-muted-foreground italic mt-0.5">{t.notes}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <Badge variant={status.variant}>{status.label}</Badge>
                  {canReceive && (
                    <Button size="sm" className="gap-1 h-7 text-xs" onClick={() => updateStatus(t.id, 'received')}>
                      <CheckCircle2 className="h-3 w-3" /> Confirmer
                    </Button>
                  )}
                  {canCancel && (
                    <Button size="sm" variant="outline" className="gap-1 h-7 text-xs text-red-600 border-red-200" onClick={() => updateStatus(t.id, 'cancelled')}>
                      <XCircle className="h-3 w-3" /> Annuler
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Cross-shop product search */}
      {activeShop && (
        <CrossShopSearch currentShopId={activeShop.id} />
      )}
    </div>
  )
}
