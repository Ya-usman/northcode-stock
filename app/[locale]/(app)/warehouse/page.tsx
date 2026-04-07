'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'
import {
  Warehouse, Plus, Truck, CheckCircle2, XCircle,
  Package, ArrowRight, ClipboardList, Search
} from 'lucide-react'
import { cn } from '@/lib/utils/cn'
import type { Product, Shop, DeliveryOrder } from '@/lib/types/database'

const supabase = createClient()

const STATUS = {
  draft:      { label: 'Brouillon',  variant: 'default'  as const, cls: 'bg-gray-100 text-gray-600' },
  dispatched: { label: 'Expédié',    variant: 'warning'  as const, cls: 'bg-amber-100 text-amber-700' },
  received:   { label: 'Réceptionné',variant: 'success'  as const, cls: 'bg-green-100 text-green-700' },
  cancelled:  { label: 'Annulé',     variant: 'danger'   as const, cls: 'bg-red-100 text-red-600' },
}

type CartItem = { product: Product; quantity: number }

export default function WarehousePage() {
  const { activeShop, userShops, profile, isSuperAdmin } = useAuthContext()
  const { toast } = useToast()

  const [orders, setOrders] = useState<any[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [otherShops, setOtherShops] = useState<Shop[]>([])
  const [loadingData, setLoadingData] = useState(true)
  const [creating, setCreating] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Form state
  const [destinationId, setDestinationId] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [notes, setNotes] = useState('')

  const warehouse = userShops.find(s => s.is_warehouse) ?? activeShop

  const load = useCallback(async () => {
    if (!warehouse?.id) return
    setLoadingData(true)
    const [{ data: o }, { data: p }] = await Promise.all([
      (supabase as any)
        .from('delivery_orders')
        .select('*, destination:destination_id(name, city), items:delivery_order_items(id, product_name, quantity, unit_cost, products(unit))')
        .eq('warehouse_id', warehouse.id)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase.from('products')
        .select('*')
        .eq('shop_id', warehouse.id)
        .eq('is_active', true)
        .gt('quantity', 0)
        .order('name'),
    ])
    setOrders(o ?? [])
    setProducts((p ?? []) as Product[])
    // Other shops (non-warehouse)
    setOtherShops(userShops.filter(s => s.id !== warehouse.id))
    setLoadingData(false)
  }, [warehouse?.id, userShops])

  useEffect(() => { load() }, [load])

  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
    (p.sku ?? '').toLowerCase().includes(productSearch.toLowerCase())
  )

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(i => i.product.id === product.id)
      if (existing) return prev.map(i => i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i)
      return [...prev, { product, quantity: 1 }]
    })
    setProductSearch('')
  }

  const updateCartQty = (productId: string, qty: number) => {
    if (qty <= 0) {
      setCart(prev => prev.filter(i => i.product.id !== productId))
    } else {
      setCart(prev => prev.map(i => i.product.id === productId ? { ...i, quantity: qty } : i))
    }
  }

  const handleDispatch = async () => {
    if (!destinationId || cart.length === 0 || !warehouse) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/warehouse/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          warehouse_id: warehouse.id,
          destination_id: destinationId,
          notes,
          items: cart.map(i => ({
            product_id: i.product.id,
            product_name: i.product.name,
            quantity: i.quantity,
            unit_cost: i.product.buying_price,
          })),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)

      toast({
        title: `Bon expédié ! ${(json.order as any).bordereau_number}`,
        description: `${cart.length} article(s) déduitsdu stock entrepôt.`,
        variant: 'success',
      })
      setCreating(false)
      setCart([])
      setDestinationId('')
      setNotes('')
      load()
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancel = async (orderId: string) => {
    if (!confirm('Annuler ce bon de livraison ? Le stock sera restitué à l\'entrepôt si déjà expédié.')) return
    await (supabase as any)
      .from('delivery_orders')
      .update({ status: 'cancelled', cancelled_by: profile?.id })
      .eq('id', orderId)
    toast({ title: 'Bon annulé', variant: 'destructive' })
    load()
  }

  if (!warehouse) {
    return (
      <div className="max-w-xl mx-auto mt-10 rounded-xl border bg-white p-8 text-center shadow-sm">
        <Warehouse className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
        <h1 className="font-bold text-lg mb-2">Aucun entrepôt configuré</h1>
        <p className="text-sm text-muted-foreground">
          Demandez à votre super admin de marquer une boutique comme entrepôt depuis le panel d'administration.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-northcode-blue text-white">
              <Warehouse className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-bold text-lg">Entrepôt — {warehouse.name}</h1>
              <p className="text-sm text-muted-foreground">{products.length} produit(s) en stock</p>
            </div>
          </div>
          <Button onClick={() => setCreating(true)} className="gap-2 bg-northcode-blue">
            <Plus className="h-4 w-4" /> Créer un bon de livraison
          </Button>
        </div>
      </div>

      {/* Create form */}
      {creating && (
        <div className="rounded-xl border bg-white p-5 shadow-sm space-y-5">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-northcode-blue" />
            Nouveau bon de livraison
          </h2>

          {/* Destination */}
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Boutique destinataire *</label>
            <select
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-northcode-blue"
              value={destinationId}
              onChange={e => setDestinationId(e.target.value)}
            >
              <option value="">Choisir une boutique</option>
              {otherShops.map(s => (
                <option key={s.id} value={s.id}>{s.name} — {s.city}</option>
              ))}
            </select>
          </div>

          {/* Product search */}
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Ajouter des produits</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                className="w-full rounded-lg border pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-northcode-blue"
                placeholder="Rechercher un produit de l'entrepôt…"
                value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
              />
            </div>

            {productSearch && (
              <div className="mt-1 rounded-lg border bg-white shadow-md max-h-48 overflow-y-auto z-10">
                {filteredProducts.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">Aucun résultat</p>
                ) : filteredProducts.map(p => (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 text-left transition-colors"
                  >
                    <span className="text-sm font-medium text-gray-900">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{p.quantity} {p.unit} dispo</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Cart */}
          {cart.length > 0 && (
            <div className="rounded-lg border overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600 flex justify-between">
                <span>Produit</span>
                <span>Qté à envoyer</span>
              </div>
              {cart.map(item => (
                <div key={item.product.id} className="flex items-center justify-between px-3 py-2.5 border-t">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.product.name}</p>
                    <p className="text-xs text-muted-foreground">Stock dispo: {item.product.quantity} {item.product.unit}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateCartQty(item.product.id, item.quantity - 1)}
                      className="h-6 w-6 rounded border flex items-center justify-center text-sm hover:bg-gray-50"
                    >−</button>
                    <input
                      type="number"
                      min={1}
                      max={item.product.quantity}
                      value={item.quantity}
                      onChange={e => updateCartQty(item.product.id, parseInt(e.target.value) || 1)}
                      className="w-14 text-center rounded border px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-northcode-blue"
                    />
                    <button
                      onClick={() => updateCartQty(item.product.id, item.quantity + 1)}
                      className="h-6 w-6 rounded border flex items-center justify-center text-sm hover:bg-gray-50"
                    >+</button>
                    <button
                      onClick={() => updateCartQty(item.product.id, 0)}
                      className="text-red-400 hover:text-red-600 text-xs ml-1"
                    >✕</button>
                  </div>
                </div>
              ))}
              <div className="bg-gray-50 px-3 py-2 text-xs text-muted-foreground">
                {cart.length} article(s) · {cart.reduce((s, i) => s + i.quantity, 0)} unité(s) au total
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-1">Notes (optionnel)</label>
            <input
              className="w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-northcode-blue"
              placeholder="Ex: Livraison urgente, fragile…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleDispatch}
              loading={submitting}
              disabled={!destinationId || cart.length === 0}
              className="gap-2 bg-northcode-blue"
            >
              <Truck className="h-4 w-4" /> Expédier
            </Button>
            <Button variant="outline" onClick={() => { setCreating(false); setCart([]) }}>
              Annuler
            </Button>
          </div>
        </div>
      )}

      {/* Orders list */}
      <div className="space-y-3">
        <h2 className="font-semibold text-gray-900">Bons de livraison</h2>
        {loadingData ? (
          <div className="rounded-xl border bg-white p-8 text-center text-sm text-muted-foreground">Chargement…</div>
        ) : orders.length === 0 ? (
          <div className="rounded-xl border bg-white p-8 text-center">
            <ClipboardList className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-medium text-gray-900">Aucun bon de livraison</p>
            <p className="text-sm text-muted-foreground mt-1">Créez votre premier bon pour distribuer le stock.</p>
          </div>
        ) : orders.map(order => {
          const s = STATUS[order.status as keyof typeof STATUS] ?? STATUS.draft
          return (
            <div key={order.id} className="rounded-xl border bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono font-bold text-northcode-blue text-sm">{order.bordereau_number}</span>
                    <span className={cn('text-xs rounded-full px-2 py-0.5 font-medium', s.cls)}>{s.label}</span>
                  </div>
                  <div className="flex items-center gap-1 text-sm text-gray-700">
                    <span className="text-muted-foreground text-xs">{warehouse.name}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium">{order.destination?.name}</span>
                    {order.destination?.city && <span className="text-xs text-muted-foreground">— {order.destination.city}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(order.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                    {order.items?.length > 0 && ` · ${order.items.length} article(s)`}
                  </p>
                  {order.notes && <p className="text-xs text-muted-foreground italic mt-0.5">{order.notes}</p>}

                  {/* Items preview */}
                  {order.items?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {order.items.slice(0, 4).map((item: any) => (
                        <span key={item.id} className="text-[10px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">
                          {item.product_name} ×{item.quantity}
                        </span>
                      ))}
                      {order.items.length > 4 && (
                        <span className="text-[10px] text-muted-foreground">+{order.items.length - 4} autres</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex gap-2 flex-shrink-0">
                  {(order.status === 'draft' || order.status === 'dispatched') && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 h-7 text-xs text-red-600 border-red-200"
                      onClick={() => handleCancel(order.id)}
                    >
                      <XCircle className="h-3 w-3" /> Annuler
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
