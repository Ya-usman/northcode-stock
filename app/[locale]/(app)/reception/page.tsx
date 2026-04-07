'use client'

import { useState } from 'react'
import { useAuthContext } from '@/lib/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { PackageCheck, Search, CheckCircle2, ArrowLeft, Package } from 'lucide-react'

export default function ReceptionPage() {
  const { activeShop } = useAuthContext()
  const { toast } = useToast()

  const [bordereauNumber, setBordereauNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [received, setReceived] = useState<any>(null)

  const handleReceive = async () => {
    if (!bordereauNumber.trim() || !activeShop) return
    setLoading(true)
    try {
      const res = await fetch('/api/warehouse/receive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bordereau_number: bordereauNumber.trim().toUpperCase(),
          shop_id: activeShop.id,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setReceived(json.order)
      toast({
        title: `Bordereau ${bordereauNumber.toUpperCase()} réceptionné !`,
        description: `Le stock a été ajouté à ${activeShop.name}.`,
        variant: 'success',
      })
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setReceived(null)
    setBordereauNumber('')
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Header */}
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-600 text-white">
            <PackageCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="font-bold text-lg">Réception de marchandises</h1>
            <p className="text-sm text-muted-foreground">
              {activeShop?.name} — Entrez le numéro de bordereau pour réceptionner
            </p>
          </div>
        </div>
      </div>

      {received ? (
        /* Success view */
        <div className="rounded-xl border bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-3 text-green-600">
            <CheckCircle2 className="h-8 w-8" />
            <div>
              <p className="font-bold text-lg">Réception confirmée</p>
              <p className="text-sm text-muted-foreground font-mono">{received.bordereau_number}</p>
            </div>
          </div>

          {/* Items received */}
          {received.delivery_order_items?.length > 0 && (
            <div className="rounded-lg border overflow-hidden">
              <div className="bg-gray-50 px-3 py-2 text-xs font-medium text-gray-600 flex justify-between">
                <span>Produit</span>
                <span>Quantité reçue</span>
              </div>
              {received.delivery_order_items.map((item: any) => (
                <div key={item.id} className="flex items-center justify-between px-3 py-2.5 border-t">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{item.product_name}</p>
                      {item.products?.unit && (
                        <p className="text-xs text-muted-foreground">{item.products.unit}</p>
                      )}
                    </div>
                  </div>
                  <span className="text-sm font-bold text-green-600">+{item.quantity}</span>
                </div>
              ))}
              <div className="bg-gray-50 px-3 py-2 text-xs text-muted-foreground">
                {received.delivery_order_items.length} article(s) ·{' '}
                {received.delivery_order_items.reduce((s: number, i: any) => s + i.quantity, 0)} unité(s) ajoutée(s) au stock
              </div>
            </div>
          )}

          <Button onClick={handleReset} variant="outline" className="gap-2 w-full">
            <ArrowLeft className="h-4 w-4" /> Réceptionner un autre bordereau
          </Button>
        </div>
      ) : (
        /* Input form */
        <div className="rounded-xl border bg-white p-6 shadow-sm space-y-5">
          <div>
            <label className="text-xs font-medium text-gray-700 block mb-2">
              Numéro de bordereau *
            </label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                className="w-full rounded-lg border pl-9 pr-3 py-3 text-sm font-mono uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="BL-0001"
                value={bordereauNumber}
                onChange={e => setBordereauNumber(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleReceive()}
                autoFocus
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              Le bordereau vous a été remis par le responsable de l'entrepôt.
            </p>
          </div>

          <Button
            onClick={handleReceive}
            loading={loading}
            disabled={!bordereauNumber.trim() || !activeShop}
            className="w-full gap-2 bg-green-600 hover:bg-green-700"
          >
            <PackageCheck className="h-4 w-4" /> Confirmer la réception
          </Button>
        </div>
      )}
    </div>
  )
}
